-- NovaBlox RobloxStudioBridge plugin.
-- Save this script as a Local Plugin in Roblox Studio.

local HttpService = game:GetService("HttpService")
local Selection = game:GetService("Selection")
local Lighting = game:GetService("Lighting")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local InsertService = game:GetService("InsertService")
local Terrain = workspace.Terrain

local VERSION = "1.0.1"
local BLENDER_TO_ROBLOX_SCALE = 3.571428
local DEFAULT_HOST = "http://localhost:30010"
local DEFAULT_POLL_SECONDS = 2
local DEFAULT_BATCH_SIZE = 20

local TOOLBAR = plugin:CreateToolbar("NovaBlox")
local TOGGLE_BUTTON = TOOLBAR:CreateButton("Bridge", "Toggle NovaBlox Bridge", "rbxassetid://4458901886")

local STATE = {
  enabled = false,
  pollThread = nil,
  streamClient = nil,
  bridgeHost = plugin:GetSetting("novablox.bridgeHost") or DEFAULT_HOST,
  apiKey = plugin:GetSetting("novablox.apiKey") or "",
  pollSeconds = plugin:GetSetting("novablox.pollSeconds") or DEFAULT_POLL_SECONDS,
  batchSize = plugin:GetSetting("novablox.batchSize") or DEFAULT_BATCH_SIZE,
  clientId = plugin:GetSetting("novablox.clientId") or ("studio-" .. HttpService:GenerateGUID(false)),
  lastError = nil,
}

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
  local body = ""
  if payload then
    body = HttpService:JSONEncode(payload)
  end

  local response = HttpService:RequestAsync({
    Url = sanitizeHost(STATE.bridgeHost) .. route,
    Method = method,
    Headers = makeHeaders(),
    Body = body,
  })
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

local function postResult(commandId, okResult, result, errorMessage)
  local body = {
    command_id = commandId,
    ok = okResult,
    status = okResult and "ok" or "error",
    result = result,
    error = errorMessage,
    plugin_version = VERSION,
    client_id = STATE.clientId,
    reported_at = nowIso(),
  }
  local response = request("POST", "/bridge/results", body)
  if not response.Success then
    warnLog("Failed to report result for command " .. tostring(commandId) .. ": " .. tostring(response.StatusCode))
  end
end

local function processCommands(commands)
  for _, command in ipairs(commands) do
    local ok, resultOrError = pcall(function()
      ChangeHistoryService:SetWaypoint("NovaBlox Begin " .. tostring(command.action))
      local result = execute(command)
      ChangeHistoryService:SetWaypoint("NovaBlox End " .. tostring(command.action))
      return result
    end)
    if ok then
      postResult(command.id, true, resultOrError, nil)
    else
      postResult(command.id, false, nil, tostring(resultOrError))
      warnLog("Command failed (" .. tostring(command.id) .. "): " .. tostring(resultOrError))
    end
  end
end

local function pullCommands()
  local limit = math.clamp(tonumber(STATE.batchSize) or DEFAULT_BATCH_SIZE, 1, 100)
  local url = "/bridge/commands?client_id=" .. HttpService:UrlEncode(STATE.clientId) .. "&limit=" .. tostring(limit)
  local response = request("GET", url, nil)
  if not response.Success then
    STATE.lastError = "pull failed (" .. tostring(response.StatusCode) .. ")"
    return
  end
  local decoded = decodeBody(response)
  if not decoded or type(decoded.commands) ~= "table" then
    return
  end
  if #decoded.commands > 0 then
    processCommands(decoded.commands)
  end
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
        STATE.lastError = tostring(err)
        warnLog("Polling loop error: " .. tostring(err))
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
    plugin:SetSetting("novablox.clientId", STATE.clientId)
    log("Bridge enabled for client " .. STATE.clientId)
    local sseStarted = false
    local ok = pcall(function()
      sseStarted = tryStartSSE()
    end)
    if ok and sseStarted then
      log("SSE notification mode enabled")
    else
      log("SSE unavailable, polling only")
    end
    startPollingLoop()
  else
    stopStreamClient()
    log("Bridge disabled")
  end
end

TOGGLE_BUTTON.Click:Connect(function()
  setEnabled(not STATE.enabled)
end)

if plugin.Unloading and plugin.Unloading.Connect then
  plugin.Unloading:Connect(function()
    setEnabled(false)
  end)
end

log("Plugin loaded. Click Plugins > NovaBlox > Bridge to connect.")
