Place your exported YOLO ONNX model here as:

`yolov8n.onnx`

Recommended export command:

```python
from ultralytics import YOLO

model = YOLO("yolov8n.pt")
model.export(format="onnx")
```

The frontend loads `/models/yolov8n.onnx` and runs inference in the browser with `onnxruntime-web`.
