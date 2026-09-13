# saveImage

Write base64 image data to a file. Accepts a raw base64 string or a `data:image/...;base64,`
data URL. Saved within the working directory; the extension sets the format.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `imageName` | string | Yes | Path to write, e.g. `screenshots/capture.png` |
| `content` | string | Yes | Base64 image data |

Returns `"image saved"` on success.

Full details: `readReference("saveImage.md")`.
