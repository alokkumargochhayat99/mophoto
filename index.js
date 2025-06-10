require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const cors = require('cors');

const app = express();

// Enable CORS
app.use(cors({
  origin: 'http://localhost:3000', // allow only this origin
  methods: ['GET', 'POST', 'PUT', 'DELETE'], // allowed methods
  credentials: true, // if using cookies/session
}));

app.use(express.json());

// Folders
const imgsFolder = path.join(__dirname, 'imgs');
const previewFolder = path.join(__dirname, 'preview');

// Download tracking
let activeDownloads = 0;
const MAX_DOWNLOADS = 200;

// Ensure folders exist
[imgsFolder, previewFolder].forEach(folder => {
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }
});

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, imgsFolder);
  },
  filename: (req, file, cb) => {
    // Keep original filename
    cb(null, file.originalname);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 5 // Max 5 files at once
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Function to create preview image
const createPreview = async (fileName) => {
  const inputPath = path.join(imgsFolder, fileName);
  const outputPath = path.join(previewFolder, fileName);
  
  try {
    await sharp(inputPath)
      .rotate()
      .resize({ width: 1000 })
      .toFormat('webp')
      .webp({ quality: 30 }) // Low quality for preview
      .toFile(outputPath);
    
    console.log(`📷 Preview created: ${fileName}`);
  } catch (error) {
    console.error(`❌ Failed to create preview for ${fileName}:`, error.message);
  }
};

// Upload API endpoint
app.post('/api/upload', upload.array('images', 5), async (req, res) => {
  // Simple auth check (optional)
  const authHeader = req.headers.authorization;
  if (process.env.UPLOAD_SECRET && authHeader !== `Bearer ${process.env.UPLOAD_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }
  
  console.log(`📤 Received ${req.files.length} files`);
  
  const results = [];
  
  for (const file of req.files) {
    try {
      // Create preview
      await createPreview(file.filename);
      
      results.push({
        filename: file.filename,
        size: file.size,
        status: 'success'
      });
      
      console.log(`✅ Processed: ${file.filename}`);
    } catch (error) {
      results.push({
        filename: file.filename,
        status: 'error',
        error: error.message
      });
      
      console.error(`❌ Failed to process: ${file.filename}`, error.message);
    }
  }
  
  res.json({
    message: 'Upload completed',
    results: results,
    totalFiles: req.files.length
  });
});

// Manual upload via admin panel
app.post('/api/admin/upload', upload.array('images', 10), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }
  
  const results = [];
  
  for (const file of req.files) {
    try {
      await createPreview(file.filename);
      results.push({
        filename: file.filename,
        size: file.size,
        status: 'success'
      });
    } catch (error) {
      results.push({
        filename: file.filename,
        status: 'error',
        error: error.message
      });
    }
  }
  
  res.json({
    message: 'Files uploaded successfully',
    results: results
  });
});

// Get paginated images API
app.get('/api/imgs', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;

  fs.readdir(imgsFolder, (err, files) => {
    if (err) {
      return res.status(500).json({ message: 'Error reading images' });
    }

    // Filter image files
    const imageFiles = files.filter(file => 
      /\.(jpg|jpeg|png|webp)$/i.test(file)
    );

    // Sort by modified time (latest first)
    const sortedFiles = imageFiles
      .map((file) => {
        const filePath = path.join(imgsFolder, file);
        const stats = fs.statSync(filePath);
        return { file, time: stats.mtime };
      })
      .sort((a, b) => b.time - a.time)
      .map(item => item.file);

    const totalImages = sortedFiles.length;
    const totalPages = Math.ceil(totalImages / limit);
    const startIndex = (page - 1) * limit;
    const paginatedFiles = sortedFiles.slice(startIndex, startIndex + limit);

    const images = paginatedFiles.map((file) => ({
      url: `${process.env.BASE_URL}/preview/${file}`, // Preview URL
      downloadUrl: `${process.env.BASE_URL}/api/download/${file}`, // Download URL
      filename: file
    }));

    res.status(200).json({
      currentPage: page,
      totalPages,
      totalImages,
      pageSize: limit,
      images: images
    });
  });
});

// Download API
app.get('/api/download/:file', async (req, res) => {
  const fileName = req.params.file;
  const filePath = path.join(imgsFolder, fileName);
   
  if (activeDownloads >= MAX_DOWNLOADS) {
    return res.status(429).json({ message: "Too many users downloading now. Please wait..." });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'File not found' });
  }
  
  activeDownloads++;
  console.log(`📥 Download started: ${fileName} (Active: ${activeDownloads})`);

  res.download(filePath, fileName, (err) => {
    activeDownloads = Math.max(0, activeDownloads - 1);
    console.log(`📥 Download finished: ${fileName} (Active: ${activeDownloads})`);
    
    if (err) {
      console.error('❌ Download error:', err.message);
    }
  });
});

// Serve preview images
app.use('/preview', express.static(previewFolder, {
  setHeaders: (res, path) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    if (path.endsWith('.webp')) {
      res.setHeader('Content-Type', 'image/webp');
    }
  }
}));

// Serve original images (for direct access if needed)
app.use('/imgs', express.static(imgsFolder, {
  setHeaders: (res, path) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
  }
}));

// Admin panel route
app.get('/admin', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Image Upload Admin</title>
        <style>
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
            .upload-area { border: 2px dashed #ccc; padding: 40px; text-align: center; margin: 20px 0; }
            .upload-area.dragover { border-color: #007bff; background-color: #f8f9fa; }
            .file-input { margin: 20px 0; }
            .upload-btn { background: #007bff; color: white; padding: 10px 20px; border: none; cursor: pointer; }
            .upload-btn:disabled { background: #ccc; }
            .results { margin: 20px 0; }
            .success { color: green; }
            .error { color: red; }
        </style>
    </head>
    <body>
        <h1>Image Upload Admin Panel</h1>
        
        <div class="upload-area" id="uploadArea">
            <p>Drag and drop images here or click to select</p>
            <input type="file" id="fileInput" multiple accept="image/*" class="file-input">
            <button id="uploadBtn" class="upload-btn">Upload Images</button>
        </div>
        
        <div id="results" class="results"></div>
        
        <script>
            const uploadArea = document.getElementById('uploadArea');
            const fileInput = document.getElementById('fileInput');
            const uploadBtn = document.getElementById('uploadBtn');
            const results = document.getElementById('results');
            
            uploadArea.addEventListener('click', () => fileInput.click());
            
            uploadArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                uploadArea.classList.add('dragover');
            });
            
            uploadArea.addEventListener('dragleave', () => {
                uploadArea.classList.remove('dragover');
            });
            
            uploadArea.addEventListener('drop', (e) => {
                e.preventDefault();
                uploadArea.classList.remove('dragover');
                fileInput.files = e.dataTransfer.files;
            });
            
            uploadBtn.addEventListener('click', async () => {
                const files = fileInput.files;
                if (files.length === 0) {
                    alert('Please select files first');
                    return;
                }
                
                const formData = new FormData();
                for (let file of files) {
                    formData.append('images', file);
                }
                
                uploadBtn.disabled = true;
                uploadBtn.textContent = 'Uploading...';
                
                try {
                    const response = await fetch('/api/admin/upload', {
                        method: 'POST',
                        body: formData
                    });
                    
                    const result = await response.json();
                    
                    results.innerHTML = '<h3>Upload Results:</h3>';
                    result.results.forEach(item => {
                        const div = document.createElement('div');
                        div.className = item.status;
                        div.textContent = item.filename + ': ' + item.status;
                        results.appendChild(div);
                    });
                    
                } catch (error) {
                    results.innerHTML = '<div class="error">Upload failed: ' + error.message + '</div>';
                }
                
                uploadBtn.disabled = false;
                uploadBtn.textContent = 'Upload Images';
                fileInput.value = '';
            });
        </script>
    </body>
    </html>
  `);
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    activeDownloads
  });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Live server running on port ${PORT}`);
  console.log(`📁 Images folder: ${imgsFolder}`);
  console.log(`👀 Preview folder: ${previewFolder}`);
  console.log(`🔗 Admin panel: http://localhost:${PORT}/admin`);
});