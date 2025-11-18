/**
 * GPT-Vis MCP Server
 *
 * A local wrapper for antvis/mcp-server-chart that generates charts locally
 * without external server dependencies.
 */

import { render } from "@yaonyan/gpt-vis-ssr-napi-rs";
import { ComposableMCPServer, composeMcpDepTools } from "@mcpc/core";
import { jsonSchema } from "ai";
import { CHART_TYPE_MAP, CHART_TYPE_UNSUPPORTED } from "./constant.ts";

import sharp from "npm:sharp";
// ---- JPEG default settings (edit here if you want different hard-coded defaults) ----
const JPEG_DEFAULTS = {
  initialQuality: 90,         // starting quality
  minQuality: 70,             // <-- floor quality (set to 50 if you want lower minimum)
  step: 10,                   // quality decrement per iteration
  maxBytes: 1_048_576,        // 1MB limit
  mozjpeg: true,              // use mozjpeg encoder
} as const;
// ----------------------------------------------------------------------------

/**
 * Chart generation options
 */
export interface ChartOptions {
  type: string;
  data: Record<string, unknown>;
  [key: string]: unknown; // Allow additional properties
}

/**
 * Chart generation result
 */
export interface ChartResult {
  isError: boolean;
  content: Array<{
    type: "text";
    text: string;
  }>;
}

/**
 * HTTP API Response (base64 mode)
 */
export interface ChartResponse {
  success: boolean;
  base64?: string;
  mimeType?: string;
  errorMessage?: string;
}

// ---- JPEG conversion & compression helpers ----
type JpegOptions = {
  initialQuality?: number; // starting quality, 1-100
  minQuality?: number;     // floor quality, 1-100
  step?: number;           // decrement step
  maxBytes?: number;       // size limit in bytes
  mozjpeg?: boolean;       // use mozjpeg encoder
};

function normalizeJpegOptions(input: unknown): Required<JpegOptions> {
  const src = (input ?? {}) as Record<string, unknown>;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const toNum = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v)) ? v : d;
  const toBool = (v: unknown, d: boolean) => (typeof v === "boolean") ? v : d;

  const initialQuality = clamp(Math.round(toNum(src.initialQuality, JPEG_DEFAULTS.initialQuality)), 1, 100);
  const minQuality = clamp(Math.round(toNum(src.minQuality, JPEG_DEFAULTS.minQuality)), 1, initialQuality);
  const step = clamp(Math.round(toNum(src.step, JPEG_DEFAULTS.step)), 1, 50);
  const maxBytes = Math.max(1, Math.round(toNum(src.maxBytes, JPEG_DEFAULTS.maxBytes)));
  const mozjpeg = toBool(src.mozjpeg, JPEG_DEFAULTS.mozjpeg);

  return { initialQuality, minQuality, step, maxBytes, mozjpeg };
}

async function encodeJpeg(buf: Uint8Array, quality: number, mozjpeg: boolean): Promise<Uint8Array> {
  return await sharp(buf).jpeg({ quality, mozjpeg }).toBuffer();
}

async function autoCompressToJpeg(
  buf: Uint8Array,
  opts: Required<JpegOptions>,
): Promise<{ output: Uint8Array; quality: number; size: number }> {
  let q = opts.initialQuality;
  let out = await encodeJpeg(buf, q, opts.mozjpeg);
  let size = out.byteLength;

  while (size > opts.maxBytes && q > opts.minQuality) {
    const nextQ = Math.max(opts.minQuality, q - opts.step);
    if (nextQ === q) break;
    q = nextQ;
    out = await encodeJpeg(buf, q, opts.mozjpeg);
    size = out.byteLength;
  }
  return { output: out, quality: q, size };
}
// ---- end helpers ----

/**
 * MCP Tool definition
 */
interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

console.error("🚀 Initializing GPT-Vis MCP Server (base64 mode, no file writes)...");

/**
 * Generate a chart with the given options (MCP format result)
 */
export async function generateChart(
  options: ChartOptions,
): Promise<ChartResult> {
  const startTime = Date.now();
  console.error(`🎨 Starting chart generation (base64 mode): type=${options.type}`);

  try {
    // Render the chart using GPT-Vis SSR
    console.error("🔄 Rendering chart with GPT-Vis SSR...");
    const vis = await render(options);
    // Render to buffer (likely PNG), then convert to JPEG and auto-compress to <= maxBytes
    const raw = await vis.toBuffer();
    const jpegUserOpts = (options as unknown as { jpeg?: JpegOptions; jpg?: JpegOptions }).jpeg
      ?? (options as unknown as { jpg?: JpegOptions }).jpg
      ?? {};
    const jpegOpts = normalizeJpegOptions(jpegUserOpts);
    console.error(`🔧 JPEG defaults in use -> initial=${JPEG_DEFAULTS.initialQuality}, min=${JPEG_DEFAULTS.minQuality}, step=${JPEG_DEFAULTS.step}, maxBytes=${JPEG_DEFAULTS.maxBytes}`);
    const { output, quality, size } = await autoCompressToJpeg(raw, jpegOpts);
    const base64 = output.toString("base64");
    const duration = Date.now() - startTime;
    console.error(`✅ Chart generated (JPEG) in ${duration}ms: quality=${quality}, size=${size} bytes`);

    return {
      isError: false,
      content: [
        {
          type: "text",
          // Return the raw JPEG base64 string as MCP text content
          text: base64,
        },
      ],
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Chart generation failed after ${duration}ms:`, errorMessage);

    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Failed to generate chart: ${errorMessage}`,
        },
      ],
    };
  }
}

/**
 * Generate a chart with the given options (HTTP format result)
 */
export async function generateChartForHttp(
  options: ChartOptions,
): Promise<ChartResponse> {
  try {
    const { type, data, ...restOptions } = options;

    // Validate chart type
    if (!type) {
      throw new Error("Chart type is required");
    }

    // Prepare render options
    const renderOptions = {
      type,
      data,
      ...restOptions,
    };

    console.error(`🎨 Starting chart generation (base64 mode): type=${type}`);
    // Render the chart using GPT-Vis SSR
    const vis = await render(renderOptions);
    console.error("✅ Successfully rendered chart with GPT-Vis SSR");
    // Render to buffer (likely PNG), then convert to JPEG and auto-compress to <= maxBytes
    const raw = await vis.toBuffer();
    const jpegUserOpts = (options as unknown as { jpeg?: JpegOptions; jpg?: JpegOptions }).jpeg
      ?? (options as unknown as { jpg?: JpegOptions }).jpg
      ?? {};
    const jpegOpts = normalizeJpegOptions(jpegUserOpts);
    console.error(`🔧 JPEG defaults in use -> initial=${JPEG_DEFAULTS.initialQuality}, min=${JPEG_DEFAULTS.minQuality}, step=${JPEG_DEFAULTS.step}, maxBytes=${JPEG_DEFAULTS.maxBytes}`);
    const { output, quality, size } = await autoCompressToJpeg(raw, jpegOpts);
    console.error(`🗜️ JPEG compression result: quality=${quality}, size=${size} bytes (limit=${jpegOpts.maxBytes})`);
    const base64 = output.toString("base64");

    return {
      success: true,
      base64,
      mimeType: "image/jpeg",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Chart generation failed:`, errorMessage);

    return {
      success: false,
      errorMessage,
    };
  }
};

/**
 * Compose MCP tools from the upstream chart server
 */
console.error("🔧 Composing MCP tools from upstream chart server...");
const { tools, cleanupClients } = await composeMcpDepTools({
  mcpServers: {
    "mcp-server-chart": {
      command: "mcp-server-chart",
      args: [],
    },
  },
});
export { cleanupClients };
console.error(
  `📊 Discovered ${Object.keys(tools).length} tools from upstream server`,
);

/**
 * Create the MCP server instance
 */
console.error("🏗️  Creating MCP server instance...");
export const server = new ComposableMCPServer(
  {
    name: "gpt-vis-mcp",
    version: "0.0.5",
  },
  { capabilities: { tools: {} } },
);
console.error("✅ MCP server instance created successfully");

/**
 * Register a tool with custom chart generation executor
 */
const registerToolWithLocalExecutor = (tool: MCPTool): void => {
  const { name, description, inputSchema } = tool;

  // Check if this chart type is supported
  if (CHART_TYPE_UNSUPPORTED.includes(name)) {
    console.error(`⚠️  Skipping unsupported chart type: ${name}`);
    return;
  }

  console.error(`🔧 Registering tool: ${name}`);

  server.tool(
    name,
    description,
    jsonSchema(inputSchema),
    async (context: unknown): Promise<ChartResult> => {
      console.error(`🚀 Executing tool: ${name}`);

      try {
        // Extract data from context
        const { data } = context as { data: Record<string, unknown> };
        console.error(
          `📝 Processing data for ${name}:`,
          Object.keys(data).length,
          "fields",
        );

        // Map the tool name to chart type
        const type = CHART_TYPE_MAP[name as keyof typeof CHART_TYPE_MAP];

        if (!type) {
          throw new Error(`Unknown chart type for tool: ${name}`);
        }

        const options: ChartOptions = {
          type,
          data,
        };

        return await generateChart(options);
      } catch (error) {
        const errorMessage = error instanceof Error
          ? error.message
          : String(error);
        console.error(`❌ Tool execution failed for ${name}:`, errorMessage);

        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Error executing ${name}: ${errorMessage}`,
            },
          ],
        };
      }
    },
  );
};

// Register all supported tools
const supportedTools = (Object.values(tools) as MCPTool[]).filter(
  (tool: MCPTool) => !CHART_TYPE_UNSUPPORTED.includes(tool.name),
);

console.error(
  `📦 Registering ${supportedTools.length} supported tools out of ${
    Object.keys(tools).length
  } total tools`,
);
console.error(
  `🚫 Skipping ${CHART_TYPE_UNSUPPORTED.length} unsupported tools:`,
  CHART_TYPE_UNSUPPORTED.join(", "),
);

supportedTools.forEach(registerToolWithLocalExecutor);

console.error("🎉 GPT-Vis MCP Server initialization completed successfully!");
console.error(`🔧 Total registered tools: ${supportedTools.length}`);
console.error("🟢 Server is ready to handle chart generation requests");
