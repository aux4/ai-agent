#### Description

Generate images from a text prompt using a configured image model. Supports single or batch image generation, configurable resolution and quality, and saving results to disk. When generating multiple images, files are created with numbered prefixes (e.g., `1-output.png`, `2-output.png`).

Key features:

- **Single or batch generation** — set `--quantity` to generate multiple images at once
- **Configurable model** — use `--model` JSON to pick the image backend (DALL-E 3, gpt-image-1, etc.)
- **Quality control** — choose between standard/hd (DALL-E) or low/medium/high/auto (gpt-image)
- **Custom resolution** — set image dimensions with `--size`

#### Usage

```bash
aux4 ai agent image [--image <file>] [--size <WxH>] [--quality <level>] [--context <true|false>] [--model <json>] [--quantity <n>] <prompt>
```

--image      File path to save the generated image
--size       Image resolution (default: 1024x1024)
--quality    Image quality: standard, hd, low, medium, high, auto (default: auto)
--context    Read additional context from stdin (default: false)
--model      Model configuration JSON (default: {})
--quantity   Number of images to generate (default: 1)
prompt       Text description of the image to generate (positional argument)

#### Example

Generate a single image:

```bash
aux4 ai agent image --prompt "red circle on white background, simple 2D drawing" --image circle.png
```

```text
Generating image...
Image saved to circle.png
```

Generate 3 images with a specific model:

```bash
aux4 ai agent image --prompt "simple geometric shapes on white background" --image shapes.png --quantity 3 --quality low --model '{"type":"openai","config":{"model":"gpt-image-1-mini"}}'
```

```text
Generating image...
Generating image 1/3...
Generating image 2/3...
Generating image 3/3...
Image saved to 1-shapes.png
Image saved to 2-shapes.png
Image saved to 3-shapes.png
```
