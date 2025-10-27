/**
 * HTTP Server for GPT-Vis MCP
 *
 * Provides HTTP API endpoint compatible with GPT-Vis-SSR service
 * while maintaining the same local chart generation capabilities.
 */

import {
  type ChartOptions,
  generateChartForHttp,
} from "./app.ts";

/**
 * HTTP API Request body
 */
interface ChartRequest extends ChartOptions {
  [key: string]: unknown; // Allow additional properties
}

/**
 * Server configuration for HTTP mode
 */
interface HttpServerConfig {
  port: number;
}

// HTTP server specific configuration
const httpConfig: HttpServerConfig = {
  port: parseInt(Deno.env.get("PORT") ?? "3000", 10),
};

/**
 * Start the HTTP server
 */
export async function startHttpServer(): Promise<void> {
  const server = Deno.serve({ port: httpConfig.port }, async (request: Request) => {
    const url = new URL(request.url);

    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // Health check endpoint
    if (url.pathname === "/health" && request.method === "GET") {
      return new Response(
        JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }),
        {
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    }

    // Chart generation endpoint (returns base64, no file writes)
    if (url.pathname === "/generate" && request.method === "POST") {
      try {
        const requestBody = (await request.json()) as ChartRequest;
        const { success, base64, mimeType, errorMessage } = await generateChartForHttp(requestBody);

        if (!success || !base64) {
          throw new Error(errorMessage ?? "Chart generation did not return base64 content");
        }

        const dataUrl = `data:${mimeType ?? "image/png"};base64,${base64}`;
        return new Response(
          JSON.stringify({ success: true, base64, dataUrl }),
          {
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders,
            },
          }
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        return new Response(
          JSON.stringify({
            success: false,
            errorMessage: `Invalid request: ${errorMessage}`,
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders,
            },
          }
        );
      }
    }

    // API documentation endpoint
    if (url.pathname === "/" && request.method === "GET") {
      const docs = `
<!DOCTYPE html>
<html>
<head>
    <title>GPT-Vis MCP HTTP Server</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .endpoint { background: #f5f5f5; padding: 15px; margin: 10px 0; border-radius: 5px; }
        .method { color: #007acc; font-weight: bold; }
        pre { background: #f0f0f0; padding: 10px; border-radius: 3px; overflow-x: auto; }
        code { white-space: pre-wrap; }
    </style>
</head>
<body>
    <h1>GPT-Vis MCP HTTP Server</h1>
    <p>Local chart generation service that returns <strong>base64</strong> (no files written).</p>
    
    <div class="endpoint">
        <h3><span class="method">POST</span> /generate</h3>
        <p>Generate a chart from the provided data and receive a base64-encoded PNG.</p>
        <p><strong>Request Body (example):</strong></p>
        <pre>{
  "type": "line",
  "data": [
    { "time": "2025-05", "value": 512 },
    { "time": "2025-06", "value": 1024 }
  ]
}</pre>
        <p><strong>Response:</strong></p>
        <pre>{
  "success": true,
  "base64": "&lt;very-long-base64&gt;",
  "dataUrl": "data:image/png;base64,&lt;very-long-base64&gt;"
}</pre>
    </div>

    <div class="endpoint">
        <h3><span class="method">GET</span> /health</h3>
        <p>Health check endpoint</p>
    </div>

    <h2>Environment Variables</h2>
    <ul>
        <li><code>PORT</code>: Server port (default: 3000)</li>
    </ul>
</body>
</html>`;

      return new Response(docs, {
        headers: {
          "Content-Type": "text/html",
          ...corsHeaders,
        },
      });
    }

    // 404 for all other routes
    return new Response("Not Found", {
      status: 404,
      headers: corsHeaders,
    });
  });

  console.log(`🌟 GPT-Vis MCP HTTP Server started!`);
  console.log(`📊 Port: ${httpConfig.port}`);
  console.log(`🚀 API docs: http://localhost:${httpConfig.port}/`);
  console.log(`💚 Health check: http://localhost:${httpConfig.port}/health`);

  // Keep the server running
  await server.finished;
}

// Start server if this file is run directly
if (import.meta.main) {
  try {
    await startHttpServer();
  } catch (error) {
    console.error("❌ Failed to start HTTP server:", error);
    Deno.exit(1);
  }
}
