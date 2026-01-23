api/generate.js
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: "Missing prompt" });
  }

  // Por ahora simulamos el vídeo
  return res.status(200).json({
    success: true,
    message: "Video generated",
    videoUrl: "https://example.com/video.mp4"
  });
}
