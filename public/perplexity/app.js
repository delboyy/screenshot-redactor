// Screenshot Redaction App - Main JavaScript
class ScreenRedactionApp {
    constructor() {
        this.currentImage = null;
        this.detectedTexts = [];
        this.redactions = [];
        this.currentTool = 'blackout';
        this.zoomLevel = 1;
        this.usageCount = parseInt(localStorage.getItem('usage_count') || '0');
        this.canvas = null;
        this.ctx = null;
        this.overlayContainer = null;
        this.pendingRedactionCallback = null;
        
        this.init();
    }

    init() {
        this.setupElements();
        this.setupEventListeners();
        this.updateUsageCounter();
    }

    setupElements() {
        // Main elements
        this.uploadZone = document.getElementById('uploadZone');
        this.processingScreen = document.getElementById('processingScreen');
        this.appInterface = document.getElementById('appInterface');
        this.fileInput = document.getElementById('fileInput');
        this.canvas = document.getElementById('mainCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.overlayContainer = document.getElementById('overlayContainer');
        
        // Progress elements
        this.processingStep = document.getElementById('processingStep');
        this.progressFill = document.getElementById('progressFill');
        
        // Sidebar elements
        this.detectionList = document.getElementById('detectionList');
        this.acceptAllBtn = document.getElementById('acceptAllBtn');
        this.rejectAllBtn = document.getElementById('rejectAllBtn');
        
        // Canvas controls
        this.zoomInBtn = document.getElementById('zoomIn');
        this.zoomOutBtn = document.getElementById('zoomOut');
        this.fitToScreenBtn = document.getElementById('fitToScreen');
        this.zoomLevelSpan = document.getElementById('zoomLevel');
        
        // Toolbar elements
        this.toolBtns = document.querySelectorAll('.tool-btn');
        this.exportBtn = document.getElementById('exportBtn');
        this.formatSelect = document.getElementById('formatSelect');
        this.stripExifCheckbox = document.getElementById('stripExif');
        
        // Modals
        this.securityModal = document.getElementById('securityModal');
        this.upgradeModal = document.getElementById('upgradeModal');
        
        // Usage counter
        this.usageText = document.getElementById('usageText');
    }

    setupEventListeners() {
        // File upload events
        document.querySelector('.browse-btn').addEventListener('click', () => {
            this.fileInput.click();
        });
        
        this.fileInput.addEventListener('change', (e) => {
            if (e.target.files[0]) {
                this.handleFileUpload(e.target.files[0]);
            }
        });

        // Drag and drop
        this.uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.uploadZone.classList.add('drag-over');
        });
        
        this.uploadZone.addEventListener('dragleave', () => {
            this.uploadZone.classList.remove('drag-over');
        });
        
        this.uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            this.uploadZone.classList.remove('drag-over');
            if (e.dataTransfer.files[0]) {
                this.handleFileUpload(e.dataTransfer.files[0]);
            }
        });

        // Paste functionality
        document.addEventListener('paste', (e) => {
            const items = e.clipboardData.items;
            for (let item of items) {
                if (item.type.startsWith('image/')) {
                    const file = item.getAsFile();
                    this.handleFileUpload(file);
                    break;
                }
            }
        });

        // Sidebar controls
        this.acceptAllBtn.addEventListener('click', () => this.acceptAllDetections());
        this.rejectAllBtn.addEventListener('click', () => this.rejectAllDetections());

        // Canvas controls
        this.zoomInBtn.addEventListener('click', () => this.adjustZoom(1.2));
        this.zoomOutBtn.addEventListener('click', () => this.adjustZoom(0.8));
        this.fitToScreenBtn.addEventListener('click', () => this.fitToScreen());

        // Tool selection
        this.toolBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.selectTool(btn.dataset.tool);
            });
        });

        // Export
        this.exportBtn.addEventListener('click', () => this.exportImage());

        // Modal controls
        document.getElementById('cancelRedaction').addEventListener('click', () => {
            this.hideModal('securityModal');
        });
        
        document.getElementById('proceedRedaction').addEventListener('click', () => {
            this.proceedWithRedaction();
            this.hideModal('securityModal');
        });

        document.getElementById('cancelUpgrade').addEventListener('click', () => {
            this.hideModal('upgradeModal');
        });

        document.querySelector('.upgrade-btn').addEventListener('click', () => {
            this.showModal('upgradeModal');
        });
    }

    async handleFileUpload(file) {
        if (this.usageCount >= 5) {
            this.showModal('upgradeModal');
            return;
        }

        if (!file.type.startsWith('image/')) {
            alert('Please select an image file');
            return;
        }

        this.showProcessingScreen();
        await this.processImage(file);
    }

    showProcessingScreen() {
        this.uploadZone.classList.add('hidden');
        this.processingScreen.classList.remove('hidden');
        this.appInterface.classList.add('hidden');
    }

    async processImage(file) {
        const steps = [
            'Uploading image...',
            'Running OCR detection...',
            'Analyzing text regions...',
            'Detection complete!'
        ];

        try {
            // Step 1: Load image
            this.updateProcessingStep(steps[0], 25);
            const imageUrl = URL.createObjectURL(file);
            this.currentImage = new Image();
            
            await new Promise((resolve) => {
                this.currentImage.onload = resolve;
                this.currentImage.src = imageUrl;
            });

            // Step 2: Initialize Tesseract (simulated for demo)
            this.updateProcessingStep(steps[1], 50);
            await this.delay(800);
            
            // Step 3: Run OCR (simulated for demo with mock data)
            this.updateProcessingStep(steps[2], 75);
            await this.delay(1000);
            
            // Generate mock detected text regions for demo
            this.generateMockDetections();

            // Step 4: Complete
            this.updateProcessingStep(steps[3], 100);
            await this.delay(500);
            
            this.showMainInterface();

        } catch (error) {
            console.error('Processing Error:', error);
            alert('Error processing image. Please try again.');
            this.resetToUpload();
        }
    }

    generateMockDetections() {
        // Generate mock text detections for demo purposes
        const mockTexts = [
            'John Doe',
            'john.doe@email.com',
            '+1 (555) 123-4567',
            'Social Security: 123-45-6789',
            'Account #: 987654321'
        ];

        const imageWidth = this.currentImage.width;
        const imageHeight = this.currentImage.height;

        this.detectedTexts = mockTexts.map((text, index) => ({
            id: index,
            text: text,
            confidence: 85 + Math.random() * 10,
            bbox: {
                x0: Math.random() * (imageWidth * 0.7),
                y0: (index * imageHeight * 0.15) + (imageHeight * 0.1),
                x1: Math.random() * (imageWidth * 0.7) + imageWidth * 0.25,
                y1: (index * imageHeight * 0.15) + (imageHeight * 0.1) + 30
            },
            accepted: false,
            redacted: false
        }));
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    updateProcessingStep(message, progress) {
        this.processingStep.textContent = message;
        this.progressFill.style.width = progress + '%';
    }

    showMainInterface() {
        this.processingScreen.classList.add('hidden');
        this.appInterface.classList.remove('hidden');
        
        this.setupCanvas();
        this.renderDetectionList();
        this.updateUsageCount();
    }

    setupCanvas() {
        if (!this.currentImage) return;
        
        const containerRect = this.canvas.parentElement.getBoundingClientRect();
        const maxWidth = containerRect.width - 40;
        const maxHeight = containerRect.height - 40;
        
        const scale = Math.min(maxWidth / this.currentImage.width, maxHeight / this.currentImage.height, 1);
        
        this.canvas.width = this.currentImage.width * scale;
        this.canvas.height = this.currentImage.height * scale;
        
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.drawImage(this.currentImage, 0, 0, this.canvas.width, this.canvas.height);
        
        this.setupOverlays();
    }

    setupOverlays() {
        this.overlayContainer.innerHTML = '';
        const canvasRect = this.canvas.getBoundingClientRect();
        const containerRect = this.overlayContainer.parentElement.getBoundingClientRect();
        
        const scaleX = this.canvas.width / this.currentImage.width;
        const scaleY = this.canvas.height / this.currentImage.height;
        
        this.detectedTexts.forEach((detection, index) => {
            if (detection.redacted) return;
            
            const overlay = document.createElement('div');
            overlay.className = 'text-overlay';
            overlay.dataset.index = index;
            
            const left = (canvasRect.left - containerRect.left) + (detection.bbox.x0 * scaleX);
            const top = (canvasRect.top - containerRect.top) + (detection.bbox.y0 * scaleY);
            const width = (detection.bbox.x1 - detection.bbox.x0) * scaleX;
            const height = (detection.bbox.y1 - detection.bbox.y0) * scaleY;
            
            overlay.style.left = left + 'px';
            overlay.style.top = top + 'px';
            overlay.style.width = width + 'px';
            overlay.style.height = height + 'px';
            
            overlay.addEventListener('click', () => {
                this.selectDetection(index);
            });
            
            this.overlayContainer.appendChild(overlay);
        });
    }

    renderDetectionList() {
        this.detectionList.innerHTML = '';
        
        this.detectedTexts.forEach((detection, index) => {
            const item = document.createElement('div');
            item.className = 'detection-item';
            item.dataset.index = index;
            
            // Create thumbnail
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = 40;
            canvas.height = 40;
            canvas.className = 'detection-thumbnail';
            
            const bbox = detection.bbox;
            const sourceX = Math.max(0, bbox.x0);
            const sourceY = Math.max(0, bbox.y0);
            const sourceWidth = Math.min(bbox.x1 - bbox.x0, this.currentImage.width - sourceX);
            const sourceHeight = Math.min(bbox.y1 - bbox.y0, this.currentImage.height - sourceY);
            
            if (sourceWidth > 0 && sourceHeight > 0) {
                ctx.drawImage(
                    this.currentImage,
                    sourceX, sourceY, sourceWidth, sourceHeight,
                    0, 0, 40, 40
                );
            }
            
            item.innerHTML = `
                <div class="detection-info">
                    <div class="detection-text">${detection.text}</div>
                    <div class="confidence-score">Confidence: ${Math.round(detection.confidence)}%</div>
                    <div class="detection-actions">
                        <button class="btn btn--sm btn--secondary accept-btn" data-index="${index}">Redact</button>
                        <button class="btn btn--sm btn--outline reject-btn" data-index="${index}">Ignore</button>
                    </div>
                </div>
            `;
            
            item.insertBefore(canvas, item.firstChild);
            
            // Add event listeners
            item.querySelector('.accept-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                this.acceptDetection(index);
            });
            
            item.querySelector('.reject-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                this.rejectDetection(index);
            });
            
            item.addEventListener('click', () => this.selectDetection(index));
            
            this.detectionList.appendChild(item);
        });
    }

    selectDetection(index) {
        // Remove previous selections
        document.querySelectorAll('.detection-item.selected').forEach(item => {
            item.classList.remove('selected');
        });
        document.querySelectorAll('.text-overlay.selected').forEach(overlay => {
            overlay.classList.remove('selected');
        });
        
        // Add new selection
        const item = document.querySelector(`.detection-item[data-index="${index}"]`);
        const overlay = document.querySelector(`.text-overlay[data-index="${index}"]`);
        
        if (item) item.classList.add('selected');
        if (overlay) overlay.classList.add('selected');
    }

    acceptDetection(index) {
        this.detectedTexts[index].accepted = true;
        this.applyRedactionToDetection(index);
    }

    rejectDetection(index) {
        this.detectedTexts[index].accepted = false;
        const overlay = document.querySelector(`.text-overlay[data-index="${index}"]`);
        if (overlay) overlay.style.display = 'none';
        
        const item = document.querySelector(`.detection-item[data-index="${index}"]`);
        if (item) item.style.opacity = '0.5';
    }

    acceptAllDetections() {
        this.detectedTexts.forEach((detection, index) => {
            if (!detection.accepted && !detection.redacted) {
                this.acceptDetection(index);
            }
        });
    }

    rejectAllDetections() {
        this.detectedTexts.forEach((detection, index) => {
            if (!detection.redacted) {
                this.rejectDetection(index);
            }
        });
    }

    selectTool(tool) {
        this.currentTool = tool;
        this.toolBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });
    }

    applyRedactionToDetection(index) {
        const detection = this.detectedTexts[index];
        
        if (['blur', 'pixelate'].includes(this.currentTool)) {
            this.showSecurityWarning(this.currentTool, () => {
                this.performRedaction(detection, index);
            });
        } else {
            this.performRedaction(detection, index);
        }
    }

    showSecurityWarning(tool, callback) {
        const warnings = {
            blur: '⚠️ Blur can be computationally reversed - use black bars for sensitive data',
            pixelate: '⚠️ Pixelation can be reversed - use black bars for security'
        };
        
        document.getElementById('securityMessage').textContent = warnings[tool];
        this.pendingRedactionCallback = callback;
        this.showModal('securityModal');
    }

    proceedWithRedaction() {
        if (this.pendingRedactionCallback) {
            this.pendingRedactionCallback();
            this.pendingRedactionCallback = null;
        }
    }

    performRedaction(detection, index) {
        const scaleX = this.canvas.width / this.currentImage.width;
        const scaleY = this.canvas.height / this.currentImage.height;
        
        const x = detection.bbox.x0 * scaleX;
        const y = detection.bbox.y0 * scaleY;
        const width = (detection.bbox.x1 - detection.bbox.x0) * scaleX;
        const height = (detection.bbox.y1 - detection.bbox.y0) * scaleY;
        
        this.ctx.save();
        
        switch (this.currentTool) {
            case 'blackout':
                this.ctx.fillStyle = '#000000';
                this.ctx.fillRect(x, y, width, height);
                break;
                
            case 'blur':
                const imageData = this.ctx.getImageData(x, y, width, height);
                this.applyBlurEffect(imageData);
                this.ctx.putImageData(imageData, x, y);
                break;
                
            case 'pixelate':
                this.applyPixelateEffect(x, y, width, height);
                break;
        }
        
        this.ctx.restore();
        detection.redacted = true;
        
        // Hide overlay
        const overlay = document.querySelector(`.text-overlay[data-index="${index}"]`);
        if (overlay) overlay.style.display = 'none';
        
        // Update list item
        const item = document.querySelector(`.detection-item[data-index="${index}"]`);
        if (item) {
            item.style.opacity = '0.6';
            const actions = item.querySelector('.detection-actions');
            if (actions) {
                actions.innerHTML = '<span class="status status--success">Redacted</span>';
            }
        }
    }

    applyBlurEffect(imageData) {
        const data = imageData.data;
        const width = imageData.width;
        const height = imageData.height;
        const original = new Uint8ClampedArray(data);
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let r = 0, g = 0, b = 0, count = 0;
                
                for (let dy = -3; dy <= 3; dy++) {
                    for (let dx = -3; dx <= 3; dx++) {
                        const ny = y + dy;
                        const nx = x + dx;
                        
                        if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
                            const idx = (ny * width + nx) * 4;
                            r += original[idx];
                            g += original[idx + 1];
                            b += original[idx + 2];
                            count++;
                        }
                    }
                }
                
                const idx = (y * width + x) * 4;
                data[idx] = r / count;
                data[idx + 1] = g / count;
                data[idx + 2] = b / count;
            }
        }
    }

    applyPixelateEffect(x, y, width, height) {
        const blockSize = 10;
        
        for (let py = y; py < y + height; py += blockSize) {
            for (let px = x; px < x + width; px += blockSize) {
                const blockWidth = Math.min(blockSize, x + width - px);
                const blockHeight = Math.min(blockSize, y + height - py);
                
                const imageData = this.ctx.getImageData(px, py, blockWidth, blockHeight);
                const data = imageData.data;
                
                let r = 0, g = 0, b = 0, count = 0;
                
                for (let i = 0; i < data.length; i += 4) {
                    r += data[i];
                    g += data[i + 1];
                    b += data[i + 2];
                    count++;
                }
                
                if (count > 0) {
                    r = Math.round(r / count);
                    g = Math.round(g / count);
                    b = Math.round(b / count);
                    
                    for (let i = 0; i < data.length; i += 4) {
                        data[i] = r;
                        data[i + 1] = g;
                        data[i + 2] = b;
                    }
                }
                
                this.ctx.putImageData(imageData, px, py);
            }
        }
    }

    adjustZoom(factor) {
        this.zoomLevel *= factor;
        this.zoomLevel = Math.max(0.1, Math.min(5, this.zoomLevel));
        this.updateZoomDisplay();
        this.applyZoom();
    }

    fitToScreen() {
        this.zoomLevel = 1;
        this.updateZoomDisplay();
        this.setupCanvas();
    }

    updateZoomDisplay() {
        this.zoomLevelSpan.textContent = Math.round(this.zoomLevel * 100) + '%';
    }

    applyZoom() {
        if (!this.canvas || !this.currentImage) return;
        
        const scale = this.zoomLevel;
        const newWidth = (this.currentImage.width * this.canvas.height / this.currentImage.height) * scale;
        const newHeight = this.canvas.height * scale;
        
        this.canvas.style.width = newWidth + 'px';
        this.canvas.style.height = newHeight + 'px';
    }

    exportImage() {
        if (!this.canvas) {
            alert('No image to export');
            return;
        }
        
        const format = this.formatSelect.value.toLowerCase();
        const stripExif = this.stripExifCheckbox.checked;
        
        let mimeType = 'image/png';
        let quality = 1;
        
        switch (format) {
            case 'jpg':
                mimeType = 'image/jpeg';
                quality = 0.9;
                break;
            case 'webp':
                mimeType = 'image/webp';
                quality = 0.9;
                break;
        }
        
        const dataUrl = this.canvas.toDataURL(mimeType, quality);
        
        const link = document.createElement('a');
        link.download = `redacted-screenshot.${format.toLowerCase()}`;
        link.href = dataUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        alert('Image exported successfully!');
    }

    updateUsageCount() {
        this.usageCount++;
        localStorage.setItem('usage_count', this.usageCount.toString());
        this.updateUsageCounter();
    }

    updateUsageCounter() {
        this.usageText.textContent = `${this.usageCount} of 5 free screenshots used`;
    }

    showModal(modalId) {
        document.getElementById(modalId).classList.remove('hidden');
    }

    hideModal(modalId) {
        document.getElementById(modalId).classList.add('hidden');
    }

    resetToUpload() {
        this.processingScreen.classList.add('hidden');
        this.appInterface.classList.add('hidden');
        this.uploadZone.classList.remove('hidden');
        
        this.currentImage = null;
        this.detectedTexts = [];
        this.redactions = [];
        this.zoomLevel = 1;
    }
}

// Initialize the app when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new ScreenRedactionApp();
});