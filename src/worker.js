// Telegram Bot API base URL
const TELEGRAM_API_BASE = 'https://api.telegram.org';

// HTML template for documentation
const DOC_HTML = `<!DOCTYPE html>
<html>
<head>
    <title>Telegram Bot API Proxy Documentation</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            line-height: 1.6;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            color: #333;
        }
        h1 { color: #0088cc; }
        .code {
            background: #f5f5f5;
            padding: 15px;
            border-radius: 5px;
            font-family: monospace;
            overflow-x: auto;
        }
        .note {
            background: #fff3cd;
            border-left: 4px solid #ffc107;
            padding: 15px;
            margin: 20px 0;
        }
        .example {
            background: #e7f5ff;
            border-left: 4px solid #0088cc;
            padding: 15px;
            margin: 20px 0;
        }
    </style>
</head>
<body>
    <h1>Telegram Bot API Proxy</h1>
    <p>This service acts as a transparent proxy for the Telegram Bot API.</p>
    
    <h2>Usage Examples:</h2>
    <div class="example">
        <p>Original: <code>https://api.telegram.org/bot{TOKEN}/sendMessage</code></p>
        <p>Proxy: <code>https://{WORKER_URL}/bot{TOKEN}/sendMessage</code></p>
    </div>
    
    <div class="note">
        <strong>Status:</strong> Proxy is running and ready to handle requests.
    </div>
</body>
</html>`;

async function handleRequest(request) {
  const url = new URL(request.url);
  
  // Serve documentation for root path
  if (url.pathname === '/' || url.pathname === '') {
    return new Response(DOC_HTML, {
      headers: {
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }

  // Parse the path to extract bot token and method
  const pathParts = url.pathname.split('/').filter(Boolean);
  
  // Validate path format: should be /bot{TOKEN}/{METHOD}
  if (pathParts.length < 2 || !pathParts[0].startsWith('bot')) {
    return new Response(JSON.stringify({
      ok: false,
      error_code: 400,
      description: 'Invalid request format. Expected: /bot{TOKEN}/{METHOD}'
    }), { 
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Construct Telegram API URL
  const telegramUrl = `${TELEGRAM_API_BASE}${url.pathname}${url.search}`;
  
  console.log(`Proxying request to: ${telegramUrl}`);

  try {
    // Prepare headers
    const headers = new Headers();
    
    // Copy important headers from original request
    for (const [key, value] of request.headers.entries()) {
      // Skip host header as it should point to Telegram's API
      if (key.toLowerCase() !== 'host' && key.toLowerCase() !== 'cf-ray' && key.toLowerCase() !== 'cf-connecting-ip') {
        headers.set(key, value);
      }
    }

    // Prepare request options
    const requestOptions = {
      method: request.method,
      headers: headers,
    };

    // Handle request body for POST/PUT requests
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const contentType = request.headers.get('content-type');
      
      if (contentType && contentType.includes('application/json')) {
        // Handle JSON payload
        const jsonBody = await request.json();
        requestOptions.body = JSON.stringify(jsonBody);
        headers.set('Content-Type', 'application/json; charset=utf-8');
      } else if (contentType && contentType.includes('multipart/form-data')) {
        // Handle multipart/form-data for file uploads
        requestOptions.body = await request.blob();
      } else {
        // Handle other body types
        requestOptions.body = await request.text();
      }
    }

    // Make request to Telegram API
    const response = await fetch(telegramUrl, requestOptions);
    
    // Create new response with CORS headers
    const newResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });

    // Add CORS headers
    newResponse.headers.set('Access-Control-Allow-Origin', '*');
    newResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
    newResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    
    return newResponse;

  } catch (error) {
    console.error('Proxy error:', error);
    
    return new Response(JSON.stringify({
      ok: false,
      error_code: 500,
      description: `Proxy error: ${error.message}`
    }), {
      status: 500,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// Handle CORS preflight requests
function handleOptions(request) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Max-Age': '86400',
  };

  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

// Main event listener
addEventListener('fetch', event => {
  const request = event.request;
  
  if (request.method === 'OPTIONS') {
    event.respondWith(handleOptions(request));
  } else {
    event.respondWith(handleRequest(request));
  }
});