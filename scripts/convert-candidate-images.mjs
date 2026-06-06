import { readdir, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const candidatesDir = join(__dirname, "..", "assets", "img", "candidates");
const targetSize = 200;
const webpQuality = 80;

async function findImages(dir) {
  const images = [];
  const entries = await readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      images.push(...await findImages(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith('.png') || entry.name.endsWith('.jpg') || entry.name.endsWith('.jpeg'))) {
      images.push(fullPath);
    }
  }
  
  return images;
}

async function convertToWebP(inputPath) {
  const outputPath = inputPath.replace(/\.(png|jpg|jpeg)$/i, '.webp');
  
  try {
    await sharp(inputPath)
      .resize(targetSize, targetSize, {
        fit: 'cover',
        position: 'center'
      })
      .webp({ quality: webpQuality })
      .toFile(outputPath);
    
    const originalSize = (await stat(inputPath)).size;
    const newSize = (await stat(outputPath)).size;
    const savings = ((originalSize - newSize) / originalSize * 100).toFixed(1);
    
    console.log(`✓ ${inputPath.replace(candidatesDir, 'candidates')} → ${savings}% smaller (${(originalSize / 1024).toFixed(0)}KB → ${(newSize / 1024).toFixed(0)}KB)`);
    
    return { success: true, inputPath, outputPath, originalSize, newSize };
  } catch (error) {
    console.error(`✗ ${inputPath.replace(candidatesDir, 'candidates')}: ${error.message}`);
    return { success: false, inputPath, error: error.message };
  }
}

async function main() {
  console.log('Finding candidate images...');
  const images = await findImages(candidatesDir);
  console.log(`Found ${images.length} images to convert\n`);
  
  const results = [];
  for (const image of images) {
    const result = await convertToWebP(image);
    results.push(result);
  }
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`\nConversion complete:`);
  console.log(`  ✓ ${successful.length} converted successfully`);
  console.log(`  ✗ ${failed.length} failed`);
  
  if (failed.length > 0) {
    console.log('\nFailed conversions:');
    failed.forEach(f => console.log(`  - ${f.inputPath.replace(candidatesDir, 'candidates')}: ${f.error}`));
  }
}

main().catch(console.error);
