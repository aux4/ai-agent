# Save Image Tool

Convert base64-encoded image data into actual image files on disk with automatic format detection and validation.

## Overview

This tool is specialized for **handling image data from digital sources** that return images as base64 strings. Use it to save AI-generated artwork, screenshots from automation tools, processed images, or any visual content that comes in base64 format.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `imageName` | string | ✅ Yes | Filename and path where the image should be saved. Can include subdirectories (`screenshots/capture.png`). Must be within current working directory |
| `content` | string | ✅ Yes | Base64-encoded image data. Accepts both raw base64 strings and data URL formats (`data:image/png;base64,...`) |

## Supported Input Formats

### 🎯 **Data URL Format** (Recommended)
```
data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...
data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQAB...
data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaH...
```

### 📄 **Raw Base64 Format**
```
iVBORw0KGgoAAAANSUhEUgAA...  (PNG)
/9j/4AAQSkZJRgABAQAAAQAB...  (JPEG)
```

## Supported Image Formats

| Format | Extension | Use Case | Compression |
|--------|-----------|----------|-------------|
| **PNG** | `.png` | Screenshots, graphics with transparency | Lossless |
| **JPEG** | `.jpg`, `.jpeg` | Photos, realistic images | Lossy |
| **GIF** | `.gif` | Simple animations, low-color graphics | Lossless |
| **SVG** | `.svg` | Vector graphics, scalable icons | Vector |
| **WebP** | `.webp` | Modern web images, good compression | Both |
| **BMP** | `.bmp` | Uncompressed bitmap images | Uncompressed |

## Security & Access Control

- **✅ Allowed locations:** Current working directory and all subdirectories only
- **❌ Restricted:** Cannot save images outside current working directory
- **📁 Directory handling:** Automatically creates parent directories if needed
- **📝 File tracking:** Tracks newly created image files for cleanup

## When to Use This Tool

- **🎨 AI-generated content:** Save images from DALL-E, Stable Diffusion, Midjourney APIs
- **📸 Screenshot capture:** Save screenshots from browser automation or UI testing tools
- **🔄 Image processing:** Save processed, filtered, or transformed images
- **📊 Data visualization:** Save generated charts, graphs, or diagrams as images
- **🎭 Asset creation:** Save generated icons, logos, or design elements
- **📱 Web scraping:** Save images extracted from web content

## File Creation Behavior

| Scenario | Behavior | Tracked for Removal |
|----------|----------|-------------------|
| **New image** | Creates image file and parent directories | ✅ Yes |
| **Existing image** | Overwrites the existing image file | ❌ No (safety) |
| **Invalid data** | Returns detailed error message | ❌ N/A |
| **Invalid path** | Returns access denied error | ❌ N/A |

## Response Format

- **✅ Success:** Returns `"Image saved to [filename]"`
- **❌ Invalid format:** Returns detailed error about data format issues
- **❌ Access denied:** Returns `"Access denied"` (when saving outside allowed locations)
- **❌ Directory creation failed:** Returns `"Directory not found"`
- **❌ Other errors:** Returns specific error message with details

## Common Error Scenarios

| Error Type | Cause | Solution |
|------------|-------|----------|
| **Invalid format** | Malformed base64 data | Verify base64 encoding is correct |
| **Access denied** | Path outside working directory | Use relative paths within project |
| **Directory failed** | Parent directory creation issue | Check path permissions and validity |
| **Corrupted data** | Incomplete or damaged base64 | Re-generate or re-encode the image data |

## Automatic Features

- **🔍 Format detection:** Automatically detects image format from data URL prefix
- **📁 Directory creation:** Creates parent directories in the path if they don't exist
- **✅ Data validation:** Validates base64 encoding before processing
- **📝 File tracking:** Tracks created files for potential cleanup later

## Performance Considerations

| Operation | Performance Impact | Recommendation |
|-----------|-------------------|----------------|
| **Large images** | Slower processing and more memory usage | Monitor memory for very large images |
| **Multiple images** | Sequential processing per call | Call tool multiple times for batch operations |
| **Complex paths** | Minimal impact on performance | Use logical directory structures |

## Strategic Usage Patterns

### 🎨 **AI Artwork Collection**
```
imageName: "ai-generated/artwork-{timestamp}.png"
content: "{ai-generated-base64-data}"
```

### 📸 **Screenshot Archive**
```
imageName: "screenshots/{date}/test-{step}.png"
content: "{screenshot-base64-data}"
```

### 📊 **Data Visualization**
```
imageName: "reports/charts/{chart-type}-{date}.svg"
content: "{chart-base64-data}"
```

> **💡 Pro Tip:** Use descriptive filenames with timestamps or identifiers to organize saved images effectively. The tool's automatic directory creation makes it easy to maintain organized image collections.