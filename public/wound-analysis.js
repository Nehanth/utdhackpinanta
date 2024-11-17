// wound-analysis.js
class WoundAnalysis {
    constructor() {
        this.setupUI();
        this.initializeEvents();
    }

    setupUI() {
        // Create doctor controls container if it doesn't exist
        let doctorControls = document.getElementById('doctorControls');
        if (!doctorControls) {
            doctorControls = document.createElement('div');
            doctorControls.id = 'doctorControls';
            doctorControls.className = 'absolute bottom-4 left-4 z-20 flex gap-2';
            doctorControls.style.display = 'none';
        }

        // Create capture button
        const captureButton = document.createElement('button');
        captureButton.id = 'captureButton';
        captureButton.className = 'btn bg-green-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2';
        captureButton.textContent = 'Capture for Analysis';

        doctorControls.appendChild(captureButton);
        document.querySelector('.video-container').appendChild(doctorControls);

        // Create analysis results container
        const analysisContainer = document.createElement('div');
        analysisContainer.id = 'analysisContainer';
        analysisContainer.className = 'hidden mt-6 bg-white rounded-lg shadow-sm border border-gray-200 p-4';
        analysisContainer.innerHTML = `
            <h3 class="text-lg font-medium text-gray-800 mb-4">Wound Analysis Results</h3>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                    <h4 class="text-sm font-medium text-gray-500 mb-2">Annotated Image</h4>
                    <img id="annotatedImage" class="w-full rounded-lg" />
                </div>
                <div>
                    <h4 class="text-sm font-medium text-gray-500 mb-2">Wound Mask</h4>
                    <img id="maskImage" class="w-full rounded-lg" />
                </div>
                <div>
                    <h4 class="text-sm font-medium text-gray-500 mb-2">Result</h4>
                    <img id="resultImage" class="w-full rounded-lg" />
                </div>
            </div>
            <div class="mt-4 p-4 bg-gray-50 rounded-lg">
                <h4 class="text-sm font-medium text-gray-500 mb-2">Measurements</h4>
                <div id="measurementResults" class="grid grid-cols-2 gap-4 text-sm"></div>
            </div>
        `;

        document.querySelector('.video-container').after(analysisContainer);
    }

    initializeEvents() {
        const captureButton = document.getElementById('captureButton');
        captureButton.addEventListener('click', () => this.captureAndAnalyze());
    }

    async captureAndAnalyze() {
        try {
            const remoteVideo = document.getElementById('remoteVideo');
            
            // Create canvas to capture video frame
            const canvas = document.createElement('canvas');
            canvas.width = remoteVideo.videoWidth;
            canvas.height = remoteVideo.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(remoteVideo, 0, 0);
            
            // Get base64 image data
            const imageData = canvas.toDataURL('image/jpeg');
            
            // Show loading state
            this.updateStatus('Analyzing wound...');
            
            // Send to analysis API
            const response = await fetch('http://localhost:5000/analyze-wound', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ image: imageData })
            });
            
            if (!response.ok) {
                throw new Error('Analysis failed');
            }
            
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Analysis failed');
            }
            
            // Display results
            this.displayResults(result);
            this.updateStatus('Analysis complete');
            
        } catch (err) {
            console.error('Analysis error:', err);
            this.updateStatus(`Error: ${err.message}`);
        }
    }

    displayResults(result) {
        // Show analysis container
        const analysisContainer = document.getElementById('analysisContainer');
        analysisContainer.classList.remove('hidden');
        
        // Update images
        document.getElementById('annotatedImage').src = result.images.annotated;
        document.getElementById('maskImage').src = result.images.mask;
        document.getElementById('resultImage').src = result.images.result;
        
        // Update measurements
        const measurementResults = document.getElementById('measurementResults');
        measurementResults.innerHTML = `
            <div>
                <p class="font-medium">Wound Area:</p>
                <p>${result.measurements.wound_area} cm²</p>
            </div>
            <div>
                <p class="font-medium">Custom-Aid Area:</p>
                <p>${result.measurements.custom_aid_area} cm²</p>
            </div>
            <div>
                <p class="font-medium">Length:</p>
                <p>${result.measurements.length} cm</p>
            </div>
            <div>
                <p class="font-medium">Width:</p>
                <p>${result.measurements.width} cm</p>
            </div>
            <div class="col-span-2 text-xs text-gray-500 mt-2">
                Analysis ID: ${result.timestamp}
            </div>
        `;
    }

    updateStatus(message) {
        const status = document.getElementById('status');
        status.textContent = message;
    }

    showForDoctor() {
        const doctorControls = document.getElementById('doctorControls');
        if (doctorControls) {
            doctorControls.style.display = 'flex';
        }
    }

    hide() {
        const doctorControls = document.getElementById('doctorControls');
        const analysisContainer = document.getElementById('analysisContainer');
        if (doctorControls) {
            doctorControls.style.display = 'none';
        }
        if (analysisContainer) {
            analysisContainer.classList.add('hidden');
        }
    }
}