# image

## generate an image

```timeout
120000
```

```execute
aux4 ai agent image --prompt "full white background, red circle 2D (not a sphere) in the middle, no shadow, no details, simple drawing, nothing else" --image image-test.png
```

```expect
Generating image...
Image saved to image-test.png
```

```afterAll
rm -f image-test.png
```

## generate multiple images

```timeout
120000
```

```execute
aux4 ai agent image --prompt "simple geometric shapes on white background" --image multi-test.png --quantity 3 --quality low --model '{"type":"openai","config":{"model":"gpt-image-1-mini"}}'
```

```expect
Generating image...
Generating image 1/3...
Generating image 2/3...
Generating image 3/3...
Image saved to 1-multi-test.png
Image saved to 2-multi-test.png
Image saved to 3-multi-test.png
```

### ask about an image

```timeout
120000
```

```execute
aux4 ai agent ask "Can you see geometric shapes in this image? Answer only yes or no." --image 1-multi-test.png --config
```

```expect:partial
yes
```

```afterAll
rm -f multi-test.png 1-multi-test.png 2-multi-test.png 3-multi-test.png
```
