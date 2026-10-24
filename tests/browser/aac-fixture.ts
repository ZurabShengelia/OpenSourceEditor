import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ff, h264Chunks } from "../helpers/ffmedia";
const dir = process.argv[2]!;
ff("-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=3", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=3", "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000:duration=3",
  "-filter_complex", "[1:a][2:a]amerge=inputs=2,volume=0.5[a]", "-map", "0:v", "-map", "[a]", "-c:v", "libvpx-vp9", "-b:v", "500k", "-c:a", "libopus", "-b:a", "128k", "-ac", "2", join(dir, "av.webm"));
ff("-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "1", "-bf", "0", "-profile:v", "high", "-x264-params", "aud=1", "-f", "h264", join(dir, "intra.h264"));
const { chunks, avcC } = h264Chunks(join(dir, "intra.h264"), 30);
writeFileSync(join(dir, "intra.json"), JSON.stringify({ avcC: Buffer.from(avcC).toString("base64"), chunks: chunks.map((c) => Buffer.from(c.data).toString("base64")) }));
console.log("fixtures written", chunks.length, "intra frames");
