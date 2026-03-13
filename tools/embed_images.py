import base64
import os
import re
import io
from PIL import Image

def embed_images(html_path, output_path):
    with open(html_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Regex to find src="manual_images/..."
    pattern = r'src=\"(manual_images/[^\"]+)\"'
    
    def replace_with_base64(match):
        img_path = match.group(1)
        full_path = os.path.join(os.path.dirname(html_path), img_path)
        
        if os.path.exists(full_path):
            with Image.open(full_path) as img:
                # Convert to RGB if it has transparency (RGBA) to save as JPEG
                if img.mode in ("RGBA", "P"):
                    img = img.convert("RGB")
                
                # Resize if wider than 800px
                max_width = 800
                if img.width > max_width:
                    ratio = max_width / float(img.width)
                    new_height = int(float(img.height) * ratio)
                    img = img.resize((max_width, new_height), Image.Resampling.LANCZOS)
                
                # Compress as JPEG to memory buffer
                buffer = io.BytesIO()
                img.save(buffer, format="JPEG", quality=70, optimize=True)
                encoded_string = base64.b64encode(buffer.getvalue()).decode('utf-8')
                
                return f'src="data:image/jpeg;base64,{encoded_string}"'
        return match.group(0) # Keep original if not found

    new_content = re.sub(pattern, replace_with_base64, content)

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(new_content)

if __name__ == "__main__":
    html_file = r"C:\Users\81806\.gemini\antigravity\scratch\golf-pwa\manual.html"
    output_file = r"C:\Users\81806\.gemini\antigravity\scratch\golf-pwa\manual_standalone.html"
    embed_images(html_file, output_file)
    print(f"Standalone manual optimized and created at: {output_file}")
