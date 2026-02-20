from pathlib import Path
import sys

SDK_DIR = Path(__file__).resolve().parents[2] / "python-sdk"
sys.path.insert(0, str(SDK_DIR))

from novablox import NovaBlox  # noqa: E402

bridge = NovaBlox(host="localhost", port=30010)
print(bridge.health())
print(bridge.spawn_part(name="HelloWorldPart", position=[0, 8, 0], color="Bright red"))
