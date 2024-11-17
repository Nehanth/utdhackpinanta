let mediaRecorder;
let streamId = null;
let mimeType;
let mediaSource;
let sourceBuffer;
let videoQueue = [];
let isBufferUpdating = false;
let fetchInterval;
let role;
let woundAnalysis;

const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const joinButton = document.getElementById('joinButton');
const roleSelect = document.getElementById('roleSelect');
const status = document.getElementById('status');
const log = document.getElementById('log');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

// Initialize wound analysis when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    woundAnalysis = new WoundAnalysis();
});

joinButton.addEventListener('click', joinConsultation);

async function joinConsultation() {
    role = roleSelect.value;
    if (!role) {
        alert('Please select a role.');
        return;
    }

    try {
        if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices.getUserMedia) {
            throw new Error('MediaRecorder API is not supported in your browser.');
        }

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        localVideo.srcObject = stream;

        const mimeTypes = [
            'video/webm;codecs=vp8,opus',
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8',
            'video/webm;codecs=vp9',
            'video/webm',
        ];

        let selectedMimeType = '';
        for (const type of mimeTypes) {
            if (MediaRecorder.isTypeSupported(type)) {
                selectedMimeType = type;
                break;
            }
        }

        if (!selectedMimeType) {
            throw new Error('No supported video mimeType found for MediaRecorder.');
        }

        console.log(`Using mimeType: ${selectedMimeType}`);
        mediaRecorder = new MediaRecorder(stream, { mimeType: selectedMimeType });
        mimeType = selectedMimeType;

        streamId = `stream_${role}`;

        mediaRecorder.addEventListener('dataavailable', event => {
            if (event.data && event.data.size > 0) {
                uploadChunk(event.data, mimeType);
            }
        });

        mediaRecorder.start(1000);

        status.textContent = 'Connected. Streaming and viewing...';
        joinButton.disabled = true;
        roleSelect.disabled = true;

        // Show/hide wound analysis controls based on role
        if (role === 'doctor') {
            woundAnalysis.showForDoctor();
        } else {
            woundAnalysis.hide();
        }

        startFetchingChunks();

        logMessage(`You are connected as ${role}`);
    } catch (err) {
        console.error('Error:', err);
        status.textContent = 'Error: ' + err.message;
    }
}

function stopConsultation() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }

    if (localVideo.srcObject) {
        localVideo.srcObject.getTracks().forEach(track => track.stop());
        localVideo.srcObject = null;
    }

    clearInterval(fetchInterval);
    fetchInterval = null;

    if (mediaSource && mediaSource.readyState === 'open') {
        mediaSource.endOfStream();
    }

    status.textContent = 'Disconnected.';
    joinButton.disabled = false;
    roleSelect.disabled = false;
    woundAnalysis.hide();
}

async function uploadChunk(chunk, mimeType) {
    try {
        const formData = new FormData();
        formData.append('streamId', streamId);
        formData.append('mimeType', mimeType);

        const extensionMap = {
            'video/webm': 'webm',
            'video/mp4': 'mp4',
        };

        const extension = extensionMap[mimeType.split(';')[0]] || 'webm';
        formData.append('videoChunk', chunk, `chunk.${extension}`);

        const response = await fetch('/uploadChunk', {
            method: 'POST',
            body: formData,
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(`${result.error}: ${result.details}`);
        }
    } catch (err) {
        console.error('Upload error:', err);
        logMessage('Error uploading chunk: ' + err.message);
    }
}

let remoteChunkIndex = 0;

function startFetchingChunks() {
    remoteChunkIndex = 0;
    setupMediaSource();

    fetchInterval = setInterval(async () => {
        try {
            const otherRole = role === 'doctor' ? 'patient' : 'doctor';
            const remoteStreamId = `stream_${otherRole}`;
            console.log(`Requesting chunk index ${remoteChunkIndex} for streamId ${remoteStreamId}, clientId ${clientId}`);
            const response = await fetch(`/getChunk?streamId=${remoteStreamId}&index=${remoteChunkIndex}&clientId=${clientId}`);
            if (response.status === 204) {
                return;
            }

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`${errorData.error}: ${errorData.details}`);
            }

            const chunkData = await response.arrayBuffer();
            videoQueue.push(chunkData);
            appendChunks();

            console.log(`Fetched and appended chunk index ${remoteChunkIndex}`);
            remoteChunkIndex++;
        } catch (err) {
            console.error('Error fetching chunk:', err);
            logMessage('Error fetching chunk: ' + err.message);
        }
    }, 1000);
}

function setupMediaSource() {
    if (!('MediaSource' in window)) {
        logMessage('MediaSource API is not supported in your browser.');
        return;
    }

    mediaSource = new MediaSource();
    remoteVideo.src = URL.createObjectURL(mediaSource);

    mediaSource.addEventListener('sourceopen', () => {
        console.log('MediaSource opened');
        let sourceBufferMimeType = mimeType;
        if (!MediaSource.isTypeSupported(mimeType)) {
            sourceBufferMimeType = 'video/webm;codecs=vp8,opus';
        }

        sourceBuffer = mediaSource.addSourceBuffer(sourceBufferMimeType);
        sourceBuffer.mode = 'sequence';

        sourceBuffer.addEventListener('updateend', () => {
            isBufferUpdating = false;
            appendChunks();
        });

        remoteVideo.play();
    });

    mediaSource.addEventListener('error', (e) => {
        console.error('MediaSource error:', e);
        logMessage('MediaSource error: ' + e.message);
    });
}

function appendChunks() {
    if (isBufferUpdating || videoQueue.length === 0) {
        return;
    }

    isBufferUpdating = true;
    const chunk = videoQueue.shift();

    try {
        sourceBuffer.appendBuffer(chunk);
    } catch (e) {
        console.error('Error appending buffer:', e);
        logMessage('Error appending buffer: ' + e.message);
        isBufferUpdating = false;
    }
}

function logMessage(message) {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.textContent = `[${timestamp}] ${message}`;
    log.appendChild(logEntry);
    log.scrollTop = log.scrollHeight;
}

window.addEventListener('beforeunload', () => {
    stopConsultation();
});