/**
 * Image utilities for compression and processing
 */

/**
 * Compresses an image file to ensure it's under 100KB
 * @param {File} file - The image file to compress
 * @returns {Promise<string>} - Compressed image as base64 data URL
 */
export async function compressImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let { width, height } = img;
                
                // Maximum file size in bytes (500KB)
                const MAX_SIZE = 500 * 1024;
                
                // Start with 0.9 quality and decrease
                let quality = 0.9;
                
                // Scale down if image is too large
                const MAX_WIDTH = 1200;
                const MAX_HEIGHT = 1200;
                
                if (width > MAX_WIDTH || height > MAX_HEIGHT) {
                    if (width > height) {
                        height = Math.round((height * MAX_WIDTH) / width);
                        width = MAX_WIDTH;
                    } else {
                        width = Math.round((width * MAX_HEIGHT) / height);
                        height = MAX_HEIGHT;
                    }
                }
                
                canvas.width = width;
                canvas.height = height;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                // Try compressing with decreasing quality until we hit target size
                const compress = () => {
                    const dataUrl = canvas.toDataURL('image/jpeg', quality);
                    const size = (dataUrl.length - 'data:image/jpeg;base64,'.length) * 3 / 4;
                    
                    if (size <= MAX_SIZE || quality <= 0.1) {
                        resolve(dataUrl);
                    } else {
                        quality -= 0.1;
                        compress();
                    }
                };
                
                compress();
            };
            
            img.onerror = reject;
            img.src = e.target.result;
        };
        
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}
