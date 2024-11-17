// server.js
import express from "express";
import multer from "multer";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import FormData from "form-data";

dotenv.config();

const app = express();

// Validate environment variables
if (!process.env.PINATA_JWT || !process.env.PINATA_GATEWAY) {
  console.error("Error: PINATA_JWT and PINATA_GATEWAY environment variables must be set.");
  process.exit(1);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB limit per chunk to accommodate video data
  },
});

app.use(cors());
app.use(express.static("public"));

// In-memory storage for active streams
const activeStreams = new Map();

// Cleanup old streams and inactive clients periodically (every minute)
setInterval(() => {
  const now = Date.now();
  for (const [streamId, streamData] of activeStreams.entries()) {
    // Remove inactive clients
    if (streamData.clients) {
      for (const [clientId, clientInfo] of streamData.clients.entries()) {
        if (now - clientInfo.lastSeen > 1000 * 60 * 5) { // 5 minutes inactivity
          streamData.clients.delete(clientId);
          console.log(`Removed inactive client ${clientId} from stream ${streamId}`);
        }
      }
    }

    // Remove old chunks
    cleanupOldChunks(streamId);

    // Remove stream if no clients and no chunks
    if (
      (!streamData.clients || streamData.clients.size === 0) &&
      (!streamData.chunks || streamData.chunks.length === 0)
    ) {
      activeStreams.delete(streamId);
      console.log(`Stream ${streamId} has been cleaned up due to inactivity.`);
    }
  }
}, 1000 * 60); // Run every minute

// Function to clean up old chunks
function cleanupOldChunks(streamId) {
  const streamData = activeStreams.get(streamId);
  if (!streamData || !streamData.clients) return;

  // Find the minimum chunkIndex among all clients
  let minChunkIndex = Infinity;
  for (const clientInfo of streamData.clients.values()) {
    if (clientInfo.chunkIndex < minChunkIndex) {
      minChunkIndex = clientInfo.chunkIndex;
    }
  }

  // Remove chunks with index less than minChunkIndex
  while (streamData.chunks.length > 0 && streamData.chunks[0].index < minChunkIndex) {
    console.log(`Deleting chunk index ${streamData.chunks[0].index} for streamId ${streamId}`);
    streamData.chunks.shift();
  }
}

// Endpoint to receive video chunks
app.post("/uploadChunk", upload.any(), async (req, res) => {
  try {
    const { streamId, mimeType } = req.body;

    // Find the videoChunk file
    const fileData = req.files.find((file) => file.fieldname === "videoChunk");

    if (!fileData || !streamId || !mimeType) {
      return res.status(400).json({
        error: "Missing required fields",
        details: "videoChunk, streamId, and mimeType are required",
      });
    }

    // Update active streams record
    if (!activeStreams.has(streamId)) {
      activeStreams.set(streamId, {
        chunks: [],
        mimeType,
        lastUpdated: Date.now(),
        nextChunkIndex: 0,
        clients: new Map(),
      });
    }

    const streamData = activeStreams.get(streamId);
    const chunkIndex = streamData.nextChunkIndex || 0;

    streamData.chunks.push({
      index: chunkIndex,
      timestamp: Date.now(),
      buffer: fileData.buffer,
    });
    streamData.nextChunkIndex = chunkIndex + 1;
    streamData.lastUpdated = Date.now();

    // Asynchronously upload to Pinata
    (async () => {
      try {
        // Create a FormData instance
        const formData = new FormData();
        const fileName = `chunk_${Date.now()}.${fileData.originalname.split('.').pop()}`;

        formData.append('file', fileData.buffer, {
          filename: fileName,
          contentType: mimeType,
        });

        const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
          },
          body: JSON.stringify({ note: noteContent }),
      });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to upload to Pinata');
        }

        console.log(`Chunk uploaded to Pinata: ${data.IpfsHash}`);
      } catch (error) {
        console.error("Upload error:", error);
        // Handle upload error if necessary
      }
    })();

    // Immediately respond to the client
    res.status(200).json({
      message: "Chunk received and uploading",
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({
      error: "Failed to upload video chunk",
      details: error.message,
    });
  }
});

// Endpoint to serve video chunks to listeners
app.get("/getChunk", async (req, res) => {
  try {
    const { streamId, index, clientId } = req.query;
    const chunkIndex = parseInt(index, 10);

    if (!streamId || isNaN(chunkIndex) || !clientId) {
      return res.status(400).json({
        error: "Invalid request",
        details: "streamId, clientId, and valid index are required",
      });
    }

    const streamData = activeStreams.get(streamId);
    if (!streamData) {
      return res.status(204).send();
    }

    // Update client's last requested chunkIndex and lastSeen
    if (!streamData.clients) {
      streamData.clients = new Map();
    }
    streamData.clients.set(clientId, {
      chunkIndex: chunkIndex,
      lastSeen: Date.now(),
    });

    const chunk = streamData.chunks.find(c => c.index === chunkIndex);

    if (!chunk) {
      // Chunk not yet available
      return res.status(204).send();
    }

    // Serve the chunk directly from memory
    const buffer = chunk.buffer;

    res.set({
      "Content-Type": streamData.mimeType,
      "Content-Length": buffer.length,
      "Cache-Control": "no-cache, no-store, must-revalidate",
    });

    res.send(buffer);

    // Update client's last requested chunkIndex
    streamData.clients.set(clientId, {
      chunkIndex: chunkIndex + 1,
      lastSeen: Date.now(),
    });

    // Clean up old chunks
    cleanupOldChunks(streamId);
  } catch (error) {
    console.error("Error fetching chunk:", error);
    res.status(500).json({
      error: "Failed to fetch video chunk",
      details: error.message,
    });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});