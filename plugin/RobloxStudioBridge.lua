-- NovaBlox RobloxStudioBridge plugin.
-- Save this script as a Local Plugin in Roblox Studio.

local HttpService = game:GetService("HttpService")
local Selection = game:GetService("Selection")
local Lighting = game:GetService("Lighting")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local InsertService = game:GetService("InsertService")
local StudioService = game:GetService("StudioService")
local Terrain = workspace.Terrain

local VERSION = "1.1.0"
local BLENDER_TO_ROBLOX_SCALE = 3.571428
local DEFAULT_HOST = "http://127.0.0.1:30010"
local DEFAULT_POLL_SECONDS = 2
local DEFAULT_BATCH_SIZE = 20
local STUDIO_SYNC_HINT = "Tip: run `npm run studio:sync` in your NovaBlox terminal to auto-fill host/API key."
local WIZARD_TERMINAL_HINT = "Terminal next: npm run doctor && npm run showcase:run"
local HEALTH_COLOR_OK = Color3.fromRGB(190, 220, 255)
local HEALTH_COLOR_ERROR = Color3.fromRGB(255, 180, 180)

local function getSettingCompat(primaryKey, legacyKey, fallback)
  local primaryValue = plugin:GetSetting(primaryKey)
  if primaryValue ~= nil then
    return primaryValue
  end
  if legacyKey then
    local legacyValue = plugin:GetSetting(legacyKey)
    if legacyValue ~= nil then
      return legacyValue
    end
  end
  return fallback
end

local TOOLBAR = plugin:CreateToolbar("NovaBlox")
local TOGGLE_BUTTON = TOOLBAR:CreateButton("Bridge", "Toggle NovaBlox Bridge", "rbxassetid://4458901886")
local PANEL_BUTTON = TOOLBAR:CreateButton("Panel", "Open NovaBlox Control Panel", "rbxassetid://4458901886")

local STATE = {
  enabled = false,
  pollThread = nil,
  streamClient = nil,
  bridgeHost = getSettingCompat("novablox.bridgeHost", "novablox_bridgeHost", DEFAULT_HOST),
  apiKey = getSettingCompat("novablox.apiKey", "novablox_apiKey", ""),
  pollSeconds = getSettingCompat("novablox.pollSeconds", "novablox_pollSeconds", DEFAULT_POLL_SECONDS),
  batchSize = getSettingCompat("novablox.batchSize", "novablox_batchSize", DEFAULT_BATCH_SIZE),
  clientId = getSettingCompat("novablox.clientId", "novablox_clientId", ("studio-" .. HttpService:GenerateGUID(false))),
  lastError = nil,
  connectionMode = "idle",
  healthOk = false,
  authOk = false,
}

local PANEL = {
  widget = nil,
  hostBox = nil,
  apiKeyBox = nil,
  pollBox = nil,
  batchBox = nil,
  clientIdBox = nil,
  statusLabel = nil,
  healthLabel = nil,
  toggleButton = nil,
  wizardStatusLabel = nil,
  wizardCommandBox = nil,
  wizardCopyButton = nil,
  wizardNextButton = nil,
}

local refreshPanelState = nil

local function log(msg)
  print("[NovaBlox] " .. msg)
end

local function warnLog(msg)
  warn("[NovaBlox] " .. msg)
end

local function sanitizeHost(host)
  if not host or host == "" then
    return DEFAULT_HOST
  end
  local cleaned = string.gsub(host, "/+$", "")
  return cleaned
end

local function parseClampedNumber(raw, fallback, minVal, maxVal)
  local parsed = tonumber(raw)
  if not parsed then
    return fallback
  end
  return math.clamp(parsed, minVal, maxVal)
end

local function nowIso()
  return DateTime.now():ToIsoDate()
end

local function makeHeaders()
  local headers = {
    ["Content-Type"] = "application/json",
    ["X-Client-Id"] = STATE.clientId,
    ["X-Plugin-Version"] = VERSION,
  }
  if STATE.apiKey ~= "" then
    headers["X-API-Key"] = STATE.apiKey
  end
  return headers
end

local function request(method, route, payload)
  local body = nil
  if payload then
    body = HttpService:JSONEncode(payload)
  end

  local requestOptions = {
    Url = sanitizeHost(STATE.bridgeHost) .. route,
    Method = method,
    Headers = makeHeaders(),
  }

  local upperMethod = string.upper(tostring(method or "GET"))
  if upperMethod ~= "GET" and upperMethod ~= "HEAD" then
    requestOptions.Body = body or ""
  end

  local response = HttpService:RequestAsync(requestOptions)
  return response
end

local function decodeBody(response)
  if not response or not response.Body or response.Body == "" then
    return nil
  end
  local ok, parsed = pcall(function()
    return HttpService:JSONDecode(response.Body)
  end)
  if not ok then
    return nil
  end
  return parsed
end

local function clipLabel(text, limit)
  local asString = tostring(text or "")
  if #asString <= limit then
    return asString
  end
  return string.sub(asString, 1, math.max(0, limit - 3)) .. "..."
end

local function setHealthLabel(text, isError)
  if not PANEL.healthLabel then
    return
  end
  PANEL.healthLabel.Text = clipLabel(tostring(text or ""), 160)
  PANEL.healthLabel.TextColor3 = isError and HEALTH_COLOR_ERROR or HEALTH_COLOR_OK
end

local function containsIgnoreCase(haystack, needle)
  if not needle or needle == "" then
    return false
  end
  local normalizedHaystack = string.lower(tostring(haystack or ""))
  local normalizedNeedle = string.lower(tostring(needle))
  return string.find(normalizedHaystack, normalizedNeedle, 1, true) ~= nil
end

local function isStudioHttpPermissionError(rawErr)
  return containsIgnoreCase(rawErr, "Http requests can only be executed by game server")
    or containsIgnoreCase(rawErr, "Http requests are not enabled")
end

local function studioHttpPermissionHint()
  return "Open a place, then Home > Game Settings > Security and enable Allow HTTP Requests + Enable Studio access to API Services. Save and restart Studio."
end

local function copyTextToClipboard(rawText)
  local text = tostring(rawText or "")
  if text == "" then
    return false, "nothing to copy"
  end

  if StudioService and StudioService.CopyToClipboard then
    local ok, err = pcall(function()
      StudioService:CopyToClipboard(text)
    end)
    if ok then
      return true, nil
    end
    if err then
      warnLog("StudioService clipboard failed: " .. tostring(err))
    end
  end

  if type(setclipboard) == "function" then
    local ok, err = pcall(function()
      setclipboard(text)
    end)
    if ok then
      return true, nil
    end
    if err then
      warnLog("setclipboard failed: " .. tostring(err))
    end
  end

  return false, "clipboard API unavailable in this Studio build; select text and press Cmd+C"
end

local function copyTextFromPanel(label, text)
  local ok, err = copyTextToClipboard(text)
  if ok then
    STATE.lastError = nil
    setHealthLabel("Health: copied " .. tostring(label) .. " to clipboard", false)
    log("Copied " .. tostring(label) .. " to clipboard")
    return
  end
  STATE.lastError = "copy failed for " .. tostring(label) .. ": " .. tostring(err)
  setHealthLabel("Health: copy unavailable (select text and press Cmd+C)", true)
  warnLog(STATE.lastError)
  if refreshPanelState then
    refreshPanelState()
  end
end

local function applyStudioHttpPermissionFailure(contextLabel, rawErr)
  if not isStudioHttpPermissionError(rawErr) then
    return false
  end
  local errMessage = tostring(contextLabel or "request failed") .. ": " .. studioHttpPermissionHint()
  STATE.lastError = errMessage
  STATE.healthOk = false
  STATE.authOk = false
  STATE.connectionMode = "blocked-http"
  setHealthLabel("Health: blocked by Studio HTTP permissions", true)
  warnLog(errMessage)
  return true
end

local function parseVector3(input)
  if typeof(input) == "Vector3" then
    return input
  end
  if type(input) ~= "table" then
    return nil
  end
  if input.x ~= nil and input.y ~= nil and input.z ~= nil then
    return Vector3.new(tonumber(input.x) or 0, tonumber(input.y) or 0, tonumber(input.z) or 0)
  end
  if input[1] and input[2] and input[3] then
    return Vector3.new(tonumber(input[1]) or 0, tonumber(input[2]) or 0, tonumber(input[3]) or 0)
  end
  return nil
end

local function parseColor3(input)
  if typeof(input) == "Color3" then
    return input
  end
  if type(input) == "table" then
    if input.r ~= nil and input.g ~= nil and input.b ~= nil then
      return Color3.new(tonumber(input.r) or 0, tonumber(input.g) or 0, tonumber(input.b) or 0)
    end
    if input[1] and input[2] and input[3] then
      local r = tonumber(input[1]) or 0
      local g = tonumber(input[2]) or 0
      local b = tonumber(input[3]) or 0
      if r > 1 or g > 1 or b > 1 then
        return Color3.fromRGB(math.clamp(r, 0, 255), math.clamp(g, 0, 255), math.clamp(b, 0, 255))
      end
      return Color3.new(r, g, b)
    end
  elseif type(input) == "string" then
    local ok, color = pcall(function()
      return BrickColor.new(input).Color
    end)
    if ok and color then
      return color
    end
  end
  return nil
end

local function findByPath(pathText)
  if type(pathText) ~= "string" or pathText == "" then
    return nil
  end
  local parts = string.split(pathText, "/")
  local node = game
  for _, name in ipairs(parts) do
    if name ~= "" then
      node = node:FindFirstChild(name)
      if not node then
        return nil
      end
    end
  end
  return node
end

local function findTarget(payload)
  if not payload then
    return nil
  end
  if payload.target_path then
    local byPath = findByPath(payload.target_path)
    if byPath then
      return byPath
    end
  end
  if payload.target_name then
    local byName = workspace:FindFirstChild(payload.target_name, true)
    if byName then
      return byName
    end
  end
  if payload.name then
    local byName = workspace:FindFirstChild(payload.name, true)
    if byName then
      return byName
    end
  end
  return nil
end

local function setArbitraryProperty(instance, propertyName, value)
  local ok, err = pcall(function()
    instance[propertyName] = value
  end)
  if not ok then
    error("property write failed: " .. tostring(err))
  end
end

local function resolveParent(payload)
  local parent = workspace
  if payload and payload.parent_path then
    local found = findByPath(payload.parent_path)
    if found then
      parent = found
    end
  end
  return parent
end

local function createScriptInstance(scriptClass, payload)
  local parent = resolveParent(payload)
  local source = payload.source or ""
  local name = payload.name or scriptClass
  local scriptInstance = Instance.new(scriptClass)
  scriptInstance.Name = name
  scriptInstance.Source = source
  scriptInstance.Parent = parent
  return scriptInstance
end

local function setTransform(target, payload)
  if not target then
    error("target not found")
  end
  local position = parseVector3(payload.position)
  local rotation = parseVector3(payload.rotation)
  local cf
  if position and rotation then
    cf = CFrame.new(position) * CFrame.Angles(math.rad(rotation.X), math.rad(rotation.Y), math.rad(rotation.Z))
  elseif position then
    cf = CFrame.new(position)
  else
    cf = nil
  end
  if target:IsA("Model") and cf then
    target:PivotTo(cf)
    return
  end
  if target:IsA("BasePart") then
    if cf then
      target.CFrame = cf
    end
    if payload.size then
      local size = parseVector3(payload.size)
      if size then
        target.Size = size
      end
    end
  end
end

local function parseScaleFactor(payload)
  local mode = tostring(payload.scale_fix or "blender_to_roblox")
  local direct = tonumber(payload.scale_factor)
  if direct and direct > 0 then
    return direct, mode
  end
  local shorthand = tonumber(payload.scale)
  if shorthand and shorthand > 0 then
    return shorthand, mode
  end
  if mode == "blender_to_roblox" then
    return BLENDER_TO_ROBLOX_SCALE, mode
  end
  if mode == "none" then
    return 1, mode
  end
  return 1, mode
end

local function scaleBasePartAroundPivot(basePart, pivot, factor)
  local rel = pivot:PointToObjectSpace(basePart.Position)
  local rotationOnly = basePart.CFrame - basePart.Position
  basePart.Size = basePart.Size * factor
  local newPos = pivot:PointToWorldSpace(rel * factor)
  basePart.CFrame = CFrame.new(newPos) * rotationOnly
end

local function applyScaleToRoot(root, factor)
  if not root or not factor or math.abs(factor - 1) < 0.0001 then
    return 0
  end

  local scaledCount = 0
  if root:IsA("Model") then
    local okScaleTo = pcall(function()
      root:ScaleTo(factor)
    end)
    if okScaleTo then
      return -1
    end
    local pivot = root:GetPivot()
    for _, descendant in ipairs(root:GetDescendants()) do
      if descendant:IsA("BasePart") then
        scaleBasePartAroundPivot(descendant, pivot, factor)
        scaledCount += 1
      end
    end
    return scaledCount
  end

  if root:IsA("BasePart") then
    root.Size = root.Size * factor
    return 1
  end

  for _, descendant in ipairs(root:GetDescendants()) do
    if descendant:IsA("Model") then
      local ok = pcall(function()
        descendant:ScaleTo(factor)
      end)
      if ok then
        scaledCount += 1
      else
        local pivot = descendant:GetPivot()
        for _, nested in ipairs(descendant:GetDescendants()) do
          if nested:IsA("BasePart") then
            scaleBasePartAroundPivot(nested, pivot, factor)
            scaledCount += 1
          end
        end
      end
    elseif descendant:IsA("BasePart") then
      descendant.Size = descendant.Size * factor
      scaledCount += 1
    end
  end

  return scaledCount
end

local function safeEnumMaterial(name, fallback)
  local fallbackMat = fallback or Enum.Material.Plastic
  if not name then
    return fallbackMat
  end
  local ok, mat = pcall(function()
    return Enum.Material[tostring(name)]
  end)
  if ok and mat then
    return mat
  end
  return fallbackMat
end

local function safeMember(obj, key)
  local ok, value = pcall(function()
    return obj[key]
  end)
  if ok then
    return value
  end
  return nil
end

local function round3(value)
  local n = tonumber(value) or 0
  return math.floor(n * 1000 + 0.5) / 1000
end

local function vectorToArray(vec)
  return { round3(vec.X), round3(vec.Y), round3(vec.Z) }
end

local function materialToString(materialEnum)
  local raw = tostring(materialEnum or "")
  return string.gsub(raw, "^Enum.Material%.", "")
end

local function colorToArray(color)
  if not color then
    return nil
  end
  return {
    math.floor(math.clamp(color.R, 0, 1) * 255 + 0.5),
    math.floor(math.clamp(color.G, 0, 1) * 255 + 0.5),
    math.floor(math.clamp(color.B, 0, 1) * 255 + 0.5),
  }
end

local function buildSceneSnapshot(payload)
  local maxObjects = math.floor(tonumber(payload.max_objects) or 500)
  maxObjects = math.clamp(maxObjects, 1, 5000)

  local queue = {}
  local queueIndex = 1
  table.insert(queue, workspace)

  local objects = {}
  local classCounts = {}
  local materialIndex = {}
  local selectionPaths = {}
  local truncated = false

  while queueIndex <= #queue do
    local node = queue[queueIndex]
    queueIndex += 1

    if node ~= workspace then
      if #objects >= maxObjects then
        truncated = true
        break
      end

      local parentPath = node.Parent and node.Parent:GetFullName() or "Workspace"
      local entry = {
        name = node.Name,
        class_name = node.ClassName,
        path = node:GetFullName(),
        parent_path = parentPath,
      }

      classCounts[node.ClassName] = (classCounts[node.ClassName] or 0) + 1

      if node:IsA("BasePart") then
        entry.position = vectorToArray(node.Position)
        entry.size = vectorToArray(node.Size)
        entry.material = materialToString(node.Material)
        entry.color = colorToArray(node.Color)
        entry.anchored = node.Anchored
        entry.can_collide = node.CanCollide
        materialIndex[entry.material] = true
      elseif node:IsA("Model") then
        local okPivot, pivot = pcall(function()
          return node:GetPivot()
        end)
        if okPivot and pivot then
          entry.pivot = {
            round3(pivot.X),
            round3(pivot.Y),
            round3(pivot.Z),
          }
        end
      end

      table.insert(objects, entry)
    end

    for _, child in ipairs(node:GetChildren()) do
      table.insert(queue, child)
    end
  end

  local materials = {}
  for matName, present in pairs(materialIndex) do
    if present then
      table.insert(materials, matName)
    end
  end
  table.sort(materials)

  local selected = Selection:Get()
  for _, instance in ipairs(selected) do
    table.insert(selectionPaths, instance:GetFullName())
  end

  return {
    root = workspace:GetFullName(),
    object_count = #objects,
    max_objects = maxObjects,
    truncated = truncated,
    class_counts = classCounts,
    materials = materials,
    selection = selectionPaths,
    collected_at = nowIso(),
    objects = objects,
  }
end

local function execute(command)
  local action = command.action
  local payload = command.payload or {}

  if action == "spawn-object" then
    local className = payload.class_name or payload.object_type or "Part"
    local obj = Instance.new(className)
    obj.Name = payload.name or className
    obj.Parent = resolveParent(payload)
    if obj:IsA("BasePart") then
      local position = parseVector3(payload.position) or Vector3.new(0, 5, 0)
      local size = parseVector3(payload.size) or Vector3.new(4, 1, 2)
      obj.Position = position
      obj.Size = size
      if payload.color then
        local color = parseColor3(payload.color)
        if color then
          obj.Color = color
        end
      end
      if payload.material then
        local ok, mat = pcall(function()
          return Enum.Material[payload.material]
        end)
        if ok and mat then
          obj.Material = mat
        end
      end
      if payload.anchored ~= nil then
        obj.Anchored = payload.anchored == true
      end
      if payload.can_collide ~= nil then
        obj.CanCollide = payload.can_collide == true
      end
    end
    return { name = obj.Name, class_name = obj.ClassName, path = obj:GetFullName() }
  end

  if action == "set-property" then
    local target = findTarget(payload)
    if not target then
      error("target not found")
    end
    if not payload.property then
      error("property is required")
    end
    setArbitraryProperty(target, payload.property, payload.value)
    return { target = target:GetFullName(), property = payload.property }
  end

  if action == "set-transform" then
    local target = findTarget(payload)
    setTransform(target, payload)
    return { target = target and target:GetFullName() or nil }
  end

  if action == "set-color" then
    local target = findTarget(payload)
    if not target or not target:IsA("BasePart") then
      error("BasePart target not found")
    end
    local color = parseColor3(payload.color)
    if not color then
      error("invalid color")
    end
    target.Color = color
    return { target = target:GetFullName() }
  end

  if action == "set-material" then
    local target = findTarget(payload)
    if not target or not target:IsA("BasePart") then
      error("BasePart target not found")
    end
    local mat = safeEnumMaterial(payload.material, Enum.Material.Plastic)
    target.Material = mat
    return { target = target:GetFullName(), material = tostring(mat) }
  end

  if action == "set-size" then
    local target = findTarget(payload)
    if not target or not target:IsA("BasePart") then
      error("BasePart target not found")
    end
    local size = parseVector3(payload.size)
    if not size then
      error("invalid size")
    end
    target.Size = size
    return { target = target:GetFullName(), size = { size.X, size.Y, size.Z } }
  end

  if action == "set-anchored" then
    local target = findTarget(payload)
    if not target or not target:IsA("BasePart") then
      error("BasePart target not found")
    end
    target.Anchored = payload.anchored == true
    return { target = target:GetFullName(), anchored = target.Anchored }
  end

  if action == "set-collidable" then
    local target = findTarget(payload)
    if not target or not target:IsA("BasePart") then
      error("BasePart target not found")
    end
    target.CanCollide = payload.can_collide == true
    return { target = target:GetFullName(), can_collide = target.CanCollide }
  end

  if action == "group-objects" then
    local groupName = payload.group_name or "Group"
    local group = Instance.new("Model")
    group.Name = groupName
    group.Parent = resolveParent(payload)
    local count = 0
    if type(payload.target_paths) == "table" then
      for _, pathText in ipairs(payload.target_paths) do
        local obj = findByPath(pathText)
        if obj then
          obj.Parent = group
          count += 1
        end
      end
    end
    return { group = group:GetFullName(), moved = count }
  end

  if action == "duplicate-object" then
    local target = findTarget(payload)
    if not target then
      error("target not found")
    end
    local clone = target:Clone()
    clone.Name = payload.new_name or (target.Name .. "_Copy")
    clone.Parent = resolveParent(payload)
    return { target = target:GetFullName(), clone = clone:GetFullName() }
  end

  if action == "delete-object" then
    local target = findTarget(payload)
    if not target then
      error("target not found")
    end
    local fullName = target:GetFullName()
    target:Destroy()
    return { deleted = fullName }
  end

  if action == "select-object" then
    local target = findTarget(payload)
    if not target then
      error("target not found")
    end
    Selection:Set({ target })
    return { selected = target:GetFullName() }
  end

  if action == "clear-selection" then
    Selection:Set({})
    return { selected = 0 }
  end

  if action == "rename-object" then
    local target = findTarget(payload)
    if not target then
      error("target not found")
    end
    target.Name = payload.new_name or target.Name
    return { target = target:GetFullName(), new_name = target.Name }
  end

  if action == "create-folder" then
    local folder = Instance.new("Folder")
    folder.Name = payload.name or "Folder"
    folder.Parent = resolveParent(payload)
    return { folder = folder:GetFullName() }
  end

  if action == "parent-object" then
    local target = findTarget(payload)
    local parent = resolveParent(payload)
    if not target then
      error("target not found")
    end
    target.Parent = parent
    return { target = target:GetFullName(), parent = parent:GetFullName() }
  end

  if action == "insert-asset-id" or action == "insert-toolbox-asset" then
    local assetId = tonumber(payload.asset_id or payload.id)
    if not assetId then
      error("asset_id is required")
    end
    local inserted = InsertService:LoadAsset(assetId)
    inserted.Parent = resolveParent(payload)
    return { asset_id = assetId, inserted = inserted:GetFullName() }
  end

  if action == "import-blender" then
    local parent = resolveParent(payload)
    local scaleFactor, scaleMode = parseScaleFactor(payload)
    local assetId = tonumber(payload.asset_id or payload.id)

    if assetId then
      local inserted = InsertService:LoadAsset(assetId)
      inserted.Name = payload.name or inserted.Name
      inserted.Parent = parent
      local scaled = applyScaleToRoot(inserted, scaleFactor)
      return {
        asset_id = assetId,
        inserted = inserted:GetFullName(),
        scale_mode = scaleMode,
        scale_factor = scaleFactor,
        scaled = scaled,
      }
    end

    return {
      accepted = true,
      message = "Blender file queued. Studio local OBJ/FBX import still requires manual import UI in many Studio builds.",
      file_path = payload.file_path,
      scale_mode = scaleMode,
      scale_factor = scaleFactor,
      hint = "After manual import, queue /bridge/scene/set-transform or /bridge/asset/import-blender with asset_id for automatic scale fix.",
    }
  end

  if action == "import-model" or action == "import-from-url" or action == "import" then
    -- Studio plugins cannot reliably import arbitrary local OBJ/FBX files with a stable public API.
    -- This command is preserved so AI flows can queue imports and then continue after user confirms import.
    return {
      accepted = true,
      message = "Import queued. If file import is needed, complete Studio import UI manually then continue automation.",
      file_path = payload.file_path,
      url = payload.url,
      recommended_blender_scale = BLENDER_TO_ROBLOX_SCALE,
    }
  end

  if action == "create-script" or action == "insert-script" then
    local scriptInstance = createScriptInstance("Script", payload)
    return { script = scriptInstance:GetFullName() }
  end

  if action == "create-local-script" or action == "insert-local-script" then
    local scriptInstance = createScriptInstance("LocalScript", payload)
    return { script = scriptInstance:GetFullName() }
  end

  if action == "create-module-script" or action == "insert-module-script" then
    local scriptInstance = createScriptInstance("ModuleScript", payload)
    return { script = scriptInstance:GetFullName() }
  end

  if action == "save-place" or action == "export-place" then
    local ok = pcall(function()
      if game.SavePlace then
        game:SavePlace()
      elseif game.SavePlaceAsync then
        game:SavePlaceAsync()
      end
    end)
    return {
      ok = ok,
      message = ok and "Save invoked" or "Save API unavailable in this Studio context",
      file_path = payload.file_path,
    }
  end

  if action == "publish-place" then
    local ok = pcall(function()
      if game.PublishToRoblox then
        game:PublishToRoblox()
      end
    end)
    return {
      ok = ok,
      message = ok and "Publish invoked" or "Publish API unavailable in this Studio context",
    }
  end

  if action == "generate-terrain" then
    local center = parseVector3(payload.center) or Vector3.new(0, 0, 0)
    local size = parseVector3(payload.size) or Vector3.new(256, 64, 256)
    local material = safeEnumMaterial(payload.material, Enum.Material.Grass)
    Terrain:FillBlock(CFrame.new(center), size, material)
    return { center = { center.X, center.Y, center.Z }, size = { size.X, size.Y, size.Z } }
  end

  if action == "fill-region" then
    local center = parseVector3(payload.center) or Vector3.new(0, 0, 0)
    local size = parseVector3(payload.size) or Vector3.new(64, 32, 64)
    local material = safeEnumMaterial(payload.material, Enum.Material.Ground)
    Terrain:FillBlock(CFrame.new(center), size, material)
    return { filled = true }
  end

  if action == "replace-material" then
    local fromMat = safeEnumMaterial(payload.from_material, Enum.Material.Grass)
    local toMat = safeEnumMaterial(payload.to_material, Enum.Material.Ground)
    local region = Region3.new(Vector3.new(-2048, -512, -2048), Vector3.new(2048, 512, 2048))
    Terrain:ReplaceMaterial(region, 4, fromMat, toMat)
    return { replaced = true }
  end

  if action == "clear-region" then
    local center = parseVector3(payload.center) or Vector3.new(0, 0, 0)
    local size = parseVector3(payload.size) or Vector3.new(64, 32, 64)
    Terrain:FillBlock(CFrame.new(center), size, Enum.Material.Air)
    return { cleared = true }
  end

  if action == "set-lighting" then
    if payload.brightness ~= nil then
      Lighting.Brightness = tonumber(payload.brightness) or Lighting.Brightness
    end
    if payload.exposure_compensation ~= nil then
      Lighting.ExposureCompensation = tonumber(payload.exposure_compensation) or Lighting.ExposureCompensation
    end
    if payload.ambient then
      local ambient = parseColor3(payload.ambient)
      if ambient then
        Lighting.Ambient = ambient
      end
    end
    return { brightness = Lighting.Brightness }
  end

  if action == "set-atmosphere" then
    local atmosphere = Lighting:FindFirstChildOfClass("Atmosphere") or Instance.new("Atmosphere")
    atmosphere.Parent = Lighting
    if payload.density ~= nil then
      atmosphere.Density = tonumber(payload.density) or atmosphere.Density
    end
    if payload.color then
      local col = parseColor3(payload.color)
      if col then
        atmosphere.Color = col
      end
    end
    return { atmosphere = true }
  end

  if action == "set-skybox" then
    local sky = Lighting:FindFirstChildOfClass("Sky") or Instance.new("Sky")
    sky.Parent = Lighting
    if payload.skybox_asset_id then
      local idString = tostring(payload.skybox_asset_id)
      sky.SkyboxBk = "rbxassetid://" .. idString
      sky.SkyboxDn = "rbxassetid://" .. idString
      sky.SkyboxFt = "rbxassetid://" .. idString
      sky.SkyboxLf = "rbxassetid://" .. idString
      sky.SkyboxRt = "rbxassetid://" .. idString
      sky.SkyboxUp = "rbxassetid://" .. idString
    end
    return { sky = true }
  end

  if action == "set-time" then
    if payload.clock_time ~= nil then
      Lighting.ClockTime = tonumber(payload.clock_time) or Lighting.ClockTime
    end
    return { clock_time = Lighting.ClockTime }
  end

  if action == "set-fog" then
    if payload.fog_start ~= nil then
      Lighting.FogStart = tonumber(payload.fog_start) or Lighting.FogStart
    end
    if payload.fog_end ~= nil then
      Lighting.FogEnd = tonumber(payload.fog_end) or Lighting.FogEnd
    end
    if payload.fog_color then
      local fogColor = parseColor3(payload.fog_color)
      if fogColor then
        Lighting.FogColor = fogColor
      end
    end
    return { fog_start = Lighting.FogStart, fog_end = Lighting.FogEnd }
  end

  if action == "introspect-scene" then
    return buildSceneSnapshot(payload)
  end

  if action == "run-command" then
    local commandName = tostring(payload.command or "")
    if commandName == "undo" then
      ChangeHistoryService:SetWaypoint("NovaBlox Undo Marker")
      return { executed = "undo-marker" }
    elseif commandName == "clear-selection" then
      Selection:Set({})
      return { executed = "clear-selection" }
    end
    return { executed = false, message = "command not recognized", command = commandName }
  end

  if action == "playtest-start" then
    return { accepted = true, message = "Playtest start queued. Trigger from Studio test controls if required." }
  end

  if action == "playtest-stop" then
    return { accepted = true, message = "Playtest stop queued. Trigger from Studio test controls if required." }
  end

  if action == "set-camera" then
    local camera = workspace.CurrentCamera
    if not camera then
      error("CurrentCamera unavailable")
    end
    local position = parseVector3(payload.position)
    local lookAt = parseVector3(payload.look_at)
    if position and lookAt then
      camera.CFrame = CFrame.lookAt(position, lookAt)
    elseif position then
      camera.CFrame = CFrame.new(position)
    end
    if payload.field_of_view then
      camera.FieldOfView = tonumber(payload.field_of_view) or camera.FieldOfView
    end
    return { camera_set = true }
  end

  if action == "focus-selection" then
    local selected = Selection:Get()
    if #selected > 0 and workspace.CurrentCamera then
      local obj = selected[1]
      if obj:IsA("BasePart") then
        workspace.CurrentCamera.CFrame = CFrame.new(obj.Position + Vector3.new(20, 20, 20), obj.Position)
      end
      return { focused = obj:GetFullName() }
    end
    return { focused = false }
  end

  if action == "screenshot" or action == "render-frame" then
    local externalCaptureUrl = payload.external_capture_url
    if externalCaptureUrl and type(externalCaptureUrl) == "string" and externalCaptureUrl ~= "" then
      local camera = workspace.CurrentCamera
      local cameraPos = nil
      if camera then
        cameraPos = { camera.CFrame.X, camera.CFrame.Y, camera.CFrame.Z }
      end
      local capturePayload = HttpService:JSONEncode({
        source = "NovaBlox",
        action = action,
        plugin_version = VERSION,
        requested_output = payload.output_name,
        timestamp = nowIso(),
        camera_position = cameraPos,
      })
      local ok, err = pcall(function()
        HttpService:PostAsync(
          externalCaptureUrl,
          capturePayload,
          Enum.HttpContentType.ApplicationJson,
          false,
          {
            ["X-NovaBlox-Source"] = "roblox-plugin",
            ["X-NovaBlox-Version"] = VERSION,
          }
        )
      end)
      return {
        accepted = true,
        external_capture_triggered = ok,
        external_capture_url = externalCaptureUrl,
        error = ok and nil or tostring(err),
        message = ok and "External capture trigger sent." or "External capture trigger failed.",
        fallback_note = "Native plugin screenshot APIs vary by Studio version; use external capture daemon or Studio screenshot plugin.",
      }
    end

    return {
      accepted = true,
      message = "Native screenshot APIs vary across Studio builds. Use external_capture_url for daemon trigger, or manual capture fallback.",
      fallback_note = "Some newer Studio builds expose capture APIs via plugins/ViewportFrame workflows, but availability is not consistent.",
    }
  end

  if action == "test-spawn" then
    local parent = resolveParent(payload)
    local marker = Instance.new("Part")
    marker.Name = payload.name or "NovaBloxConnected"
    marker.Size = parseVector3(payload.size) or Vector3.new(6, 1, 6)
    marker.Position = parseVector3(payload.position) or Vector3.new(0, 8, 0)
    marker.Material = Enum.Material.Neon
    marker.Color = parseColor3(payload.color) or Color3.fromRGB(0, 255, 170)
    marker.Anchored = true
    marker.CanCollide = false
    marker.Parent = parent

    local light = Instance.new("PointLight")
    light.Brightness = tonumber(payload.brightness) or 3
    light.Range = tonumber(payload.range) or 20
    light.Color = marker.Color
    light.Parent = marker

    local billboard = Instance.new("BillboardGui")
    billboard.Name = "NovaBloxStatus"
    billboard.Size = UDim2.new(0, 220, 0, 50)
    billboard.StudsOffset = Vector3.new(0, 3, 0)
    billboard.AlwaysOnTop = true
    billboard.Parent = marker

    local text = Instance.new("TextLabel")
    text.Size = UDim2.new(1, 0, 1, 0)
    text.BackgroundTransparency = 1
    text.TextColor3 = Color3.new(1, 1, 1)
    text.TextStrokeTransparency = 0.4
    text.Font = Enum.Font.GothamBold
    text.TextScaled = true
    text.Text = payload.text or "NovaBlox Connected"
    text.Parent = billboard

    return {
      spawned = marker:GetFullName(),
      billboard = billboard:GetFullName(),
      message = "NovaBlox test spawn complete",
    }
  end

  if action == "autosave" then
    local ok = pcall(function()
      if game.SavePlace then
        game:SavePlace()
      elseif game.SavePlaceAsync then
        game:SavePlaceAsync()
      end
    end)
    return { ok = ok, message = ok and "autosave invoked" or "autosave unavailable" }
  end

  error("unsupported action: " .. tostring(action))
end

local function makeResultPayload(command, okResult, result, errorMessage, executionMs)
  return {
    command_id = command and command.id or nil,
    ok = okResult,
    status = okResult and "ok" or "error",
    result = result,
    error = errorMessage,
    execution_ms = executionMs,
    plugin_version = VERSION,
    client_id = STATE.clientId,
    dispatch_token = command and command.dispatch_token or nil,
    attempts = command and command.attempts or nil,
    reported_at = nowIso(),
  }
end

local function postSingleResult(payload)
  local commandId = payload and payload.command_id or nil
  local response = request("POST", "/bridge/results", payload or {})
  if not response.Success then
    warnLog("Failed to report result for command " .. tostring(commandId) .. ": " .. tostring(response.StatusCode))
    return false
  end
  return true
end

local function postBatchResults(payloads)
  if #payloads == 0 then
    return true
  end
  local response = request("POST", "/bridge/results/batch", {
    results = payloads,
    plugin_version = VERSION,
    client_id = STATE.clientId,
    reported_at = nowIso(),
  })
  if not response.Success then
    return false
  end
  local decoded = decodeBody(response)
  if decoded and tonumber(decoded.error_count or 0) and tonumber(decoded.error_count or 0) > 0 then
    warnLog("Batch result reported with errors: " .. tostring(decoded.error_count))
  end
  return true
end

local function processCommands(commands)
  local results = {}
  for _, command in ipairs(commands) do
    local started = os.clock()
    local ok, resultOrError = pcall(function()
      ChangeHistoryService:SetWaypoint("NovaBlox Begin " .. tostring(command.action))
      local result = execute(command)
      ChangeHistoryService:SetWaypoint("NovaBlox End " .. tostring(command.action))
      return result
    end)
    local executionMs = math.floor((os.clock() - started) * 1000 + 0.5)
    if ok then
      table.insert(results, makeResultPayload(command, true, resultOrError, nil, executionMs))
    else
      table.insert(results, makeResultPayload(command, false, nil, tostring(resultOrError), executionMs))
      warnLog("Command failed (" .. tostring(command.id) .. "): " .. tostring(resultOrError))
    end
  end

  if #results == 0 then
    return
  end

  if #results == 1 then
    postSingleResult(results[1])
    return
  end

  local batchOk = postBatchResults(results)
  if batchOk then
    return
  end

  warnLog("Batch result endpoint unavailable, falling back to single-result posts")
  for _, payload in ipairs(results) do
    postSingleResult(payload)
  end
end

local function pullCommands()
  local limit = math.clamp(tonumber(STATE.batchSize) or DEFAULT_BATCH_SIZE, 1, 100)
  local url = "/bridge/commands?client_id=" .. HttpService:UrlEncode(STATE.clientId) .. "&limit=" .. tostring(limit)
  local response = request("GET", url, nil)
  if not response.Success then
    local statusCode = tostring(response.StatusCode)
    local decodedError = decodeBody(response)
    local detail = nil
    if decodedError then
      detail = decodedError.error or decodedError.message or decodedError.status
    end
    local message = "pull failed (" .. statusCode .. ")"
    if detail and tostring(detail) ~= "" then
      message = message .. ": " .. tostring(detail)
    end
    if statusCode == "401" then
      message = message .. " | run npm run studio:sync, restart Studio, then Enable"
      STATE.authOk = false
    end
    STATE.lastError = clipLabel(message, 180)
    if refreshPanelState then
      refreshPanelState()
    end
    return 0
  end
  STATE.lastError = nil
  STATE.authOk = true
  local decoded = decodeBody(response)
  if not decoded or type(decoded.commands) ~= "table" then
    STATE.lastError = "pull decode failed"
    if refreshPanelState then
      refreshPanelState()
    end
    return 0
  end
  if #decoded.commands > 0 then
    processCommands(decoded.commands)
  end
  if refreshPanelState then
    refreshPanelState()
  end
  return #decoded.commands
end

local function stopStreamClient()
  if STATE.streamClient then
    local client = STATE.streamClient
    STATE.streamClient = nil
    pcall(function()
      local disconnectMethod = safeMember(client, "Disconnect")
      local closeMethod = safeMember(client, "Close")
      if disconnectMethod then
        client:Disconnect()
      elseif closeMethod then
        client:Close()
      end
    end)
  end
end

local function tryStartSSE()
  if not HttpService.CreateWebStreamClient then
    return false
  end
  local url = sanitizeHost(STATE.bridgeHost) .. "/bridge/stream?client_id=" .. HttpService:UrlEncode(STATE.clientId)
  if STATE.apiKey ~= "" then
    url = url .. "&api_key=" .. HttpService:UrlEncode(STATE.apiKey)
  end

  local ok, client = pcall(function()
    return HttpService:CreateWebStreamClient(url)
  end)
  if not ok or not client then
    return false
  end
  STATE.streamClient = client

  local function onMessage(_message)
    if STATE.enabled then
      pullCommands()
    end
  end

  local connected = false
  local eventCandidates = {
    safeMember(client, "OnMessage"),
    safeMember(client, "MessageReceived"),
    safeMember(client, "OnEvent"),
  }
  for _, ev in ipairs(eventCandidates) do
    if ev and ev.Connect then
      pcall(function()
        ev:Connect(onMessage)
      end)
      connected = true
      break
    end
  end

  local onErrorEvent = safeMember(client, "OnError")
  if onErrorEvent and onErrorEvent.Connect then
    onErrorEvent:Connect(function(err)
      warnLog("SSE error: " .. tostring(err))
    end)
  end

  local connectMethod = safeMember(client, "Connect")
  if connectMethod then
    pcall(function()
      client:Connect()
    end)
  end

  return connected
end

local function startPollingLoop()
  if STATE.pollThread ~= nil then
    return
  end
  STATE.pollThread = task.spawn(function()
    while STATE.enabled do
      local ok, err = pcall(function()
        pullCommands()
      end)
      if not ok then
        if applyStudioHttpPermissionFailure("polling loop error", err) then
          STATE.enabled = false
          TOGGLE_BUTTON:SetActive(false)
          stopStreamClient()
          if refreshPanelState then
            refreshPanelState()
          end
          break
        end
        STATE.lastError = tostring(err)
        warnLog("Polling loop error: " .. tostring(err))
        if refreshPanelState then
          refreshPanelState()
        end
      end
      task.wait(math.max(0.2, tonumber(STATE.pollSeconds) or DEFAULT_POLL_SECONDS))
    end
    STATE.pollThread = nil
  end)
end

local function setEnabled(enabled)
  STATE.enabled = enabled
  TOGGLE_BUTTON:SetActive(enabled)
  if enabled then
    STATE.lastError = nil
    plugin:SetSetting("novablox.clientId", STATE.clientId)
    log("Bridge enabled for client " .. STATE.clientId)
    local sseStarted = false
    local ok = pcall(function()
      sseStarted = tryStartSSE()
    end)
    if ok and sseStarted then
      STATE.connectionMode = "sse"
      log("SSE notification mode enabled")
    else
      STATE.connectionMode = "polling"
      log("SSE unavailable, polling only")
    end
    startPollingLoop()
  else
    stopStreamClient()
    STATE.connectionMode = "idle"
    log("Bridge disabled")
  end
  if refreshPanelState then
    refreshPanelState()
  end
end

local function trimString(raw)
  return string.gsub(tostring(raw or ""), "^%s*(.-)%s*$", "%1")
end

local function syncPanelInputsFromState()
  if PANEL.hostBox then
    PANEL.hostBox.Text = STATE.bridgeHost
  end
  if PANEL.apiKeyBox then
    PANEL.apiKeyBox.Text = STATE.apiKey
  end
  if PANEL.pollBox then
    PANEL.pollBox.Text = tostring(STATE.pollSeconds)
  end
  if PANEL.batchBox then
    PANEL.batchBox.Text = tostring(STATE.batchSize)
  end
  if PANEL.clientIdBox then
    PANEL.clientIdBox.Text = STATE.clientId
  end
end

local function boolMark(value)
  if value then
    return "[x]"
  end
  return "[ ]"
end

local function refreshWizardPanel()
  if not PANEL.wizardStatusLabel or not PANEL.wizardCommandBox or not PANEL.wizardNextButton then
    return
  end

  local stepConfigured = STATE.apiKey ~= ""
  local stepHealth = STATE.healthOk == true and STATE.authOk == true
  local stepEnabled = STATE.enabled == true
  local stepReady = stepConfigured and stepHealth and stepEnabled

  PANEL.wizardStatusLabel.Text =
    boolMark(stepConfigured) .. " Step 1: Host/API key saved\n"
    .. boolMark(stepHealth) .. " Step 2: Health/auth OK\n"
    .. boolMark(stepEnabled) .. " Step 3: Bridge enabled\n"
    .. boolMark(stepReady) .. " Step 4: Doctor + showcase"

  if not stepConfigured then
    PANEL.wizardCommandBox.Text = "npm run secure:local\nnpm run studio:sync\n# restart Studio, then click Save"
    PANEL.wizardNextButton.Text = "Next: Save"
    return
  end

  if not stepHealth then
    if STATE.connectionMode == "blocked-http" or isStudioHttpPermissionError(STATE.lastError) then
      PANEL.wizardCommandBox.Text = "Open a place in Studio.\nHome > Game Settings > Security:\n- Allow HTTP Requests = ON\n- Enable Studio access to API Services = ON\nSave, restart Studio, then click Health."
      PANEL.wizardNextButton.Text = "Next: Fix Studio HTTP"
      return
    end
    PANEL.wizardCommandBox.Text = "npm run studio:sync\n# restart Studio, then click Health"
    PANEL.wizardNextButton.Text = "Next: Health"
    return
  end

  if not stepEnabled then
    PANEL.wizardCommandBox.Text = "Bridge is healthy. Click Enable."
    PANEL.wizardNextButton.Text = "Next: Enable"
    return
  end

  PANEL.wizardCommandBox.Text = WIZARD_TERMINAL_HINT
  PANEL.wizardNextButton.Text = "Next: Pull Once"
end

refreshPanelState = function()
  if not PANEL.widget then
    return
  end
  local apiKeySummary = "empty"
  local lastErrorText = tostring(STATE.lastError or "none")
  if STATE.apiKey ~= "" then
    apiKeySummary = "set (" .. tostring(string.len(STATE.apiKey)) .. " chars)"
  end
  if PANEL.statusLabel then
    PANEL.statusLabel.TextColor3 = STATE.lastError and HEALTH_COLOR_ERROR or Color3.fromRGB(235, 235, 235)
    PANEL.statusLabel.Text = "Status: "
      .. (STATE.enabled and "enabled" or "disabled")
      .. "\nMode: "
      .. tostring(STATE.connectionMode or "idle")
      .. "\nHost: "
      .. tostring(sanitizeHost(STATE.bridgeHost))
      .. "\nClient: "
      .. tostring(STATE.clientId)
      .. "\nAPI key: "
      .. apiKeySummary
      .. "\nLast error:\n"
      .. clipLabel(lastErrorText, 200)
  end
  if PANEL.toggleButton then
    PANEL.toggleButton.Text = STATE.enabled and "Disable" or "Enable"
  end
  refreshWizardPanel()
end

local function refreshHealthFromPanel()
  if not PANEL.healthLabel then
    return
  end
  setHealthLabel("Health: checking...", false)
  local ok, responseOrErr = pcall(function()
    return request("GET", "/bridge/health", nil)
  end)
  if not ok then
    if applyStudioHttpPermissionFailure("health request failed", responseOrErr) then
      refreshPanelState()
      return
    end
    local errMessage = "health request failed: " .. tostring(responseOrErr)
    STATE.lastError = errMessage
    STATE.healthOk = false
    STATE.authOk = false
    setHealthLabel("Health: request failed", true)
    warnLog(errMessage)
    refreshPanelState()
    return
  end

  local response = responseOrErr
  if not response.Success then
    local statusCode = tostring(response.StatusCode)
    local decodedError = decodeBody(response)
    local detail = nil
    if decodedError then
      detail = decodedError.error or decodedError.message or decodedError.status
    end
    local errMessage = "health request failed (" .. statusCode .. ")"
    if detail and tostring(detail) ~= "" then
      errMessage = errMessage .. ": " .. tostring(detail)
    end
    STATE.lastError = errMessage
    STATE.healthOk = false
    STATE.authOk = false
    local label = "Health: HTTP " .. statusCode
    if detail and tostring(detail) ~= "" then
      label = label .. " (" .. tostring(detail) .. ")"
    end
    setHealthLabel(label, true)
    warnLog(errMessage)
    refreshPanelState()
    return
  end

  local decoded = decodeBody(response)
  if not decoded then
    STATE.lastError = "health decode failed"
    STATE.healthOk = false
    STATE.authOk = false
    setHealthLabel("Health: decode failed", true)
    refreshPanelState()
    return
  end

  STATE.healthOk = true
  local authOk, authResponseOrErr = pcall(function()
    return request("GET", "/bridge/stats", nil)
  end)
  if not authOk then
    if applyStudioHttpPermissionFailure("auth check failed", authResponseOrErr) then
      refreshPanelState()
      return
    end
    local errMessage = "auth check failed: " .. tostring(authResponseOrErr)
    STATE.lastError = errMessage
    STATE.authOk = false
    setHealthLabel("Health: ok | auth request failed", true)
    warnLog(errMessage)
    refreshPanelState()
    return
  end

  local authResponse = authResponseOrErr
  if not authResponse.Success then
    local authStatusCode = tostring(authResponse.StatusCode)
    local authDecoded = decodeBody(authResponse)
    local authDetail = nil
    if authDecoded then
      authDetail = authDecoded.error or authDecoded.message or authDecoded.status
    end
    local errMessage = "auth check failed (" .. authStatusCode .. ")"
    if authDetail and tostring(authDetail) ~= "" then
      errMessage = errMessage .. ": " .. tostring(authDetail)
    end
    if authStatusCode == "401" then
      errMessage = errMessage .. " | run npm run studio:sync, restart Studio, then Enable"
    end
    STATE.lastError = errMessage
    STATE.authOk = false
    local label = "Health: ok | auth HTTP " .. authStatusCode
    if authDetail and tostring(authDetail) ~= "" then
      label = label .. " (" .. tostring(authDetail) .. ")"
    end
    setHealthLabel(label, true)
    warnLog(errMessage)
    refreshPanelState()
    return
  end

  STATE.lastError = nil
  STATE.authOk = true
  local queue = decoded.queue or {}
  setHealthLabel("Health: " .. tostring(decoded.status or "unknown")
    .. " | auth=ok"
    .. " | queued=" .. tostring(queue.pending_count or "?")
    .. " | total=" .. tostring(queue.total_commands or "?"), false)
  refreshPanelState()
end

local function saveSettingsFromPanel()
  if not PANEL.hostBox then
    return
  end

  local wasEnabled = STATE.enabled
  local previousHost = STATE.bridgeHost
  local previousApiKey = STATE.apiKey
  local previousClientId = STATE.clientId

  STATE.bridgeHost = sanitizeHost(trimString(PANEL.hostBox.Text))
  STATE.apiKey = trimString(PANEL.apiKeyBox and PANEL.apiKeyBox.Text or "")
  STATE.pollSeconds = parseClampedNumber(PANEL.pollBox and PANEL.pollBox.Text, DEFAULT_POLL_SECONDS, 0.2, 30)
  STATE.batchSize = math.floor(parseClampedNumber(PANEL.batchBox and PANEL.batchBox.Text, DEFAULT_BATCH_SIZE, 1, 100) + 0.5)

  local nextClientId = trimString(PANEL.clientIdBox and PANEL.clientIdBox.Text or "")
  if nextClientId == "" then
    nextClientId = "studio-" .. HttpService:GenerateGUID(false)
  end
  STATE.clientId = nextClientId

  plugin:SetSetting("novablox.bridgeHost", STATE.bridgeHost)
  plugin:SetSetting("novablox_bridgeHost", STATE.bridgeHost)
  plugin:SetSetting("novablox.apiKey", STATE.apiKey)
  plugin:SetSetting("novablox_apiKey", STATE.apiKey)
  plugin:SetSetting("novablox.pollSeconds", STATE.pollSeconds)
  plugin:SetSetting("novablox_pollSeconds", STATE.pollSeconds)
  plugin:SetSetting("novablox.batchSize", STATE.batchSize)
  plugin:SetSetting("novablox_batchSize", STATE.batchSize)
  plugin:SetSetting("novablox.clientId", STATE.clientId)
  plugin:SetSetting("novablox_clientId", STATE.clientId)

  local requiresReconnect = wasEnabled and (
    previousHost ~= STATE.bridgeHost
    or previousApiKey ~= STATE.apiKey
    or previousClientId ~= STATE.clientId
  )
  if requiresReconnect then
    setEnabled(false)
    setEnabled(true)
  end

  syncPanelInputsFromState()
  refreshPanelState()
  log("Panel settings saved")
end

local function pullOnceFromPanel()
  local ok, resultOrErr = pcall(function()
    return pullCommands()
  end)
  if not ok then
    if applyStudioHttpPermissionFailure("manual pull failed", resultOrErr) then
      refreshPanelState()
      return
    end
    STATE.lastError = tostring(resultOrErr)
    warnLog("Manual pull failed: " .. tostring(resultOrErr))
  else
    STATE.lastError = nil
    log("Manual pull completed (" .. tostring(resultOrErr) .. " commands)")
  end
  refreshPanelState()
end

local function runWizardNextStep()
  if STATE.apiKey == "" then
    saveSettingsFromPanel()
    if STATE.apiKey == "" then
      STATE.lastError = "API key is empty. Run npm run studio:sync, then Save."
    end
    refreshPanelState()
    return
  end

  if not STATE.healthOk or not STATE.authOk then
    refreshHealthFromPanel()
    return
  end

  if not STATE.enabled then
    setEnabled(true)
    refreshPanelState()
    return
  end

  pullOnceFromPanel()
end

local function createPanel()
  if PANEL.widget then
    return PANEL.widget
  end

  local widgetInfo = DockWidgetPluginGuiInfo.new(
    Enum.InitialDockState.Right,
    false,
    false,
    420,
    620,
    320,
    420
  )
  local widget = plugin:CreateDockWidgetPluginGui("NovaBlox.ControlPanel", widgetInfo)
  widget.Title = "NovaBlox Control"
  widget.Enabled = false
  PANEL.widget = widget

  local root = Instance.new("Frame")
  root.Size = UDim2.fromScale(1, 1)
  root.BackgroundColor3 = Color3.fromRGB(30, 30, 30)
  root.BorderSizePixel = 0
  root.Parent = widget

  local padding = Instance.new("UIPadding")
  padding.PaddingTop = UDim.new(0, 10)
  padding.PaddingBottom = UDim.new(0, 10)
  padding.PaddingLeft = UDim.new(0, 10)
  padding.PaddingRight = UDim.new(0, 10)
  padding.Parent = root

  local list = Instance.new("UIListLayout")
  list.FillDirection = Enum.FillDirection.Vertical
  list.Padding = UDim.new(0, 8)
  list.SortOrder = Enum.SortOrder.LayoutOrder
  list.Parent = root

  local function createField(labelText, initialText, placeholderText, clearTextOnFocus)
    local row = Instance.new("Frame")
    row.Size = UDim2.new(1, 0, 0, 50)
    row.BackgroundTransparency = 1
    row.Parent = root

    local label = Instance.new("TextLabel")
    label.Size = UDim2.new(1, 0, 0, 16)
    label.BackgroundTransparency = 1
    label.Font = Enum.Font.Gotham
    label.TextSize = 12
    label.TextColor3 = Color3.fromRGB(220, 220, 220)
    label.TextXAlignment = Enum.TextXAlignment.Left
    label.Text = labelText
    label.Parent = row

    local box = Instance.new("TextBox")
    box.Size = UDim2.new(1, 0, 0, 30)
    box.Position = UDim2.new(0, 0, 0, 18)
    box.BackgroundColor3 = Color3.fromRGB(45, 45, 45)
    box.BorderColor3 = Color3.fromRGB(80, 80, 80)
    box.ClearTextOnFocus = clearTextOnFocus == true
    box.Font = Enum.Font.Code
    box.TextSize = 13
    box.TextColor3 = Color3.fromRGB(245, 245, 245)
    box.PlaceholderText = placeholderText or ""
    box.Text = tostring(initialText or "")
    box.TextXAlignment = Enum.TextXAlignment.Left
    box.Parent = row
    return box
  end

  PANEL.hostBox = createField("Bridge Host", STATE.bridgeHost, "http://127.0.0.1:30010", false)
  PANEL.apiKeyBox = createField("API Key", STATE.apiKey, "(optional)", false)
  PANEL.pollBox = createField("Poll Seconds", tostring(STATE.pollSeconds), "2", false)
  PANEL.batchBox = createField("Batch Size", tostring(STATE.batchSize), "20", false)
  PANEL.clientIdBox = createField("Client ID", STATE.clientId, "studio-<guid>", false)

  local hintLabel = Instance.new("TextLabel")
  hintLabel.Size = UDim2.new(1, 0, 0, 34)
  hintLabel.BackgroundTransparency = 1
  hintLabel.Font = Enum.Font.Gotham
  hintLabel.TextSize = 11
  hintLabel.TextColor3 = Color3.fromRGB(175, 205, 255)
  hintLabel.TextWrapped = true
  hintLabel.TextXAlignment = Enum.TextXAlignment.Left
  hintLabel.TextYAlignment = Enum.TextYAlignment.Top
  hintLabel.Text = STUDIO_SYNC_HINT .. " Use Copy Cmd in the wizard for long terminal commands."
  hintLabel.Parent = root

  local statusLabel = Instance.new("TextLabel")
  statusLabel.Size = UDim2.new(1, 0, 0, 90)
  statusLabel.BackgroundColor3 = Color3.fromRGB(38, 38, 38)
  statusLabel.BorderColor3 = Color3.fromRGB(80, 80, 80)
  statusLabel.Font = Enum.Font.Code
  statusLabel.TextSize = 12
  statusLabel.TextColor3 = Color3.fromRGB(235, 235, 235)
  statusLabel.TextXAlignment = Enum.TextXAlignment.Left
  statusLabel.TextYAlignment = Enum.TextYAlignment.Top
  statusLabel.TextWrapped = true
  statusLabel.Text = "Status: idle"
  statusLabel.Parent = root
  PANEL.statusLabel = statusLabel

  local healthLabel = Instance.new("TextLabel")
  healthLabel.Size = UDim2.new(1, 0, 0, 24)
  healthLabel.BackgroundTransparency = 1
  healthLabel.Font = Enum.Font.Gotham
  healthLabel.TextSize = 12
  healthLabel.TextColor3 = HEALTH_COLOR_OK
  healthLabel.TextXAlignment = Enum.TextXAlignment.Left
  healthLabel.Text = "Health: not checked"
  healthLabel.Parent = root
  PANEL.healthLabel = healthLabel

  local wizardFrame = Instance.new("Frame")
  wizardFrame.Size = UDim2.new(1, 0, 0, 160)
  wizardFrame.BackgroundColor3 = Color3.fromRGB(35, 43, 56)
  wizardFrame.BorderColor3 = Color3.fromRGB(84, 103, 134)
  wizardFrame.Parent = root

  local wizardTitle = Instance.new("TextLabel")
  wizardTitle.Size = UDim2.new(1, -8, 0, 16)
  wizardTitle.Position = UDim2.new(0, 4, 0, 4)
  wizardTitle.BackgroundTransparency = 1
  wizardTitle.Font = Enum.Font.GothamBold
  wizardTitle.TextSize = 12
  wizardTitle.TextColor3 = Color3.fromRGB(214, 228, 255)
  wizardTitle.TextXAlignment = Enum.TextXAlignment.Left
  wizardTitle.Text = "First-Run Wizard"
  wizardTitle.Parent = wizardFrame

  local wizardStatusLabel = Instance.new("TextLabel")
  wizardStatusLabel.Size = UDim2.new(1, -8, 0, 64)
  wizardStatusLabel.Position = UDim2.new(0, 4, 0, 22)
  wizardStatusLabel.BackgroundTransparency = 1
  wizardStatusLabel.Font = Enum.Font.Code
  wizardStatusLabel.TextSize = 10
  wizardStatusLabel.TextColor3 = Color3.fromRGB(226, 233, 250)
  wizardStatusLabel.TextXAlignment = Enum.TextXAlignment.Left
  wizardStatusLabel.TextYAlignment = Enum.TextYAlignment.Top
  wizardStatusLabel.TextWrapped = true
  wizardStatusLabel.Text = "[ ] Step 1\n[ ] Step 2\n[ ] Step 3\n[ ] Step 4"
  wizardStatusLabel.Parent = wizardFrame
  PANEL.wizardStatusLabel = wizardStatusLabel

  local wizardCommandBox = Instance.new("TextBox")
  wizardCommandBox.Size = UDim2.new(1, -8, 0, 44)
  wizardCommandBox.Position = UDim2.new(0, 4, 0, 88)
  wizardCommandBox.BackgroundColor3 = Color3.fromRGB(22, 28, 38)
  wizardCommandBox.BorderColor3 = Color3.fromRGB(84, 103, 134)
  wizardCommandBox.ClearTextOnFocus = false
  wizardCommandBox.Font = Enum.Font.Code
  wizardCommandBox.TextSize = 11
  wizardCommandBox.TextColor3 = Color3.fromRGB(224, 236, 255)
  wizardCommandBox.TextXAlignment = Enum.TextXAlignment.Left
  wizardCommandBox.TextYAlignment = Enum.TextYAlignment.Top
  wizardCommandBox.TextWrapped = true
  wizardCommandBox.MultiLine = true
  pcall(function()
    wizardCommandBox.TextEditable = true
  end)
  wizardCommandBox.Text = "Wizard loading..."
  wizardCommandBox.Parent = wizardFrame
  PANEL.wizardCommandBox = wizardCommandBox

  local wizardCopyButton = Instance.new("TextButton")
  wizardCopyButton.Size = UDim2.new(0.48, -6, 0, 20)
  wizardCopyButton.Position = UDim2.new(0, 4, 0, 136)
  wizardCopyButton.BackgroundColor3 = Color3.fromRGB(54, 84, 122)
  wizardCopyButton.BorderColor3 = Color3.fromRGB(95, 127, 168)
  wizardCopyButton.Font = Enum.Font.GothamSemibold
  wizardCopyButton.TextSize = 11
  wizardCopyButton.TextColor3 = Color3.fromRGB(239, 247, 255)
  wizardCopyButton.Text = "Copy Cmd"
  wizardCopyButton.Parent = wizardFrame
  PANEL.wizardCopyButton = wizardCopyButton

  local wizardNextButton = Instance.new("TextButton")
  wizardNextButton.Size = UDim2.new(0.48, -6, 0, 20)
  wizardNextButton.Position = UDim2.new(0.52, 2, 0, 136)
  wizardNextButton.BackgroundColor3 = Color3.fromRGB(70, 104, 164)
  wizardNextButton.BorderColor3 = Color3.fromRGB(110, 146, 214)
  wizardNextButton.Font = Enum.Font.GothamSemibold
  wizardNextButton.TextSize = 11
  wizardNextButton.TextColor3 = Color3.fromRGB(246, 250, 255)
  wizardNextButton.Text = "Next Step"
  wizardNextButton.Parent = wizardFrame
  PANEL.wizardNextButton = wizardNextButton

  local buttons = Instance.new("Frame")
  buttons.Size = UDim2.new(1, 0, 0, 32)
  buttons.BackgroundTransparency = 1
  buttons.Parent = root

  local function createButton(text, xScale)
    local button = Instance.new("TextButton")
    button.Size = UDim2.new(0.24, -4, 1, 0)
    button.Position = UDim2.new(xScale, 0, 0, 0)
    button.BackgroundColor3 = Color3.fromRGB(60, 60, 60)
    button.BorderColor3 = Color3.fromRGB(100, 100, 100)
    button.Font = Enum.Font.GothamSemibold
    button.TextSize = 12
    button.TextColor3 = Color3.fromRGB(245, 245, 245)
    button.Text = text
    button.Parent = buttons
    return button
  end

  local saveButton = createButton("Save", 0.00)
  local healthButton = createButton("Health", 0.25)
  local pullButton = createButton("Pull Once", 0.50)
  local toggleButton = createButton("Enable", 0.75)
  PANEL.toggleButton = toggleButton

  saveButton.MouseButton1Click:Connect(saveSettingsFromPanel)
  healthButton.MouseButton1Click:Connect(refreshHealthFromPanel)
  pullButton.MouseButton1Click:Connect(pullOnceFromPanel)
  toggleButton.MouseButton1Click:Connect(function()
    setEnabled(not STATE.enabled)
  end)
  wizardCopyButton.MouseButton1Click:Connect(function()
    copyTextFromPanel("wizard command", PANEL.wizardCommandBox and PANEL.wizardCommandBox.Text or "")
  end)
  wizardNextButton.MouseButton1Click:Connect(runWizardNextStep)

  widget:GetPropertyChangedSignal("Enabled"):Connect(function()
    if widget.Enabled then
      PANEL_BUTTON:SetActive(true)
      syncPanelInputsFromState()
      refreshPanelState()
    else
      PANEL_BUTTON:SetActive(false)
    end
  end)

  syncPanelInputsFromState()
  refreshPanelState()
  return widget
end

TOGGLE_BUTTON.Click:Connect(function()
  setEnabled(not STATE.enabled)
end)

PANEL_BUTTON.Click:Connect(function()
  local panel = createPanel()
  panel.Enabled = not panel.Enabled
end)

if plugin.Unloading and plugin.Unloading.Connect then
  plugin.Unloading:Connect(function()
    setEnabled(false)
  end)
end

log("Plugin loaded. Use Plugins > NovaBlox > Bridge to toggle or Panel for first-run wizard/settings.")
