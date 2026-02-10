/**
 * Comprehensive Web & API Test Suite
 * Tests: Static files, Filtering API, Health Check, and MCP Integration
 */

const http = require('http');
const app = require('./api/index.js');
const fs = require('fs');
const path = require('path');

const PORT = 3999;
let server;

async function startServer() {
  return new Promise((resolve) => {
    server = app.listen(PORT, '127.0.0.1', () => {
      console.log(`Test server started on port ${PORT}`);
      resolve();
    });
  });
}

async function stopServer() {
  return new Promise((resolve) => {
    server.close(() => {
      console.log('Test server stopped');
      resolve();
    });
  });
}

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      ...options
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: data
        });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('\n🚀 Starting Web Functional Tests...\n');
  
  try {
    await startServer();
    let passed = 0;
    let failed = 0;

    const test = async (name, fn) => {
      try {
        await fn();
        console.log(`✅ PASSED: ${name}`);
        passed++;
      } catch (err) {
        console.log(`❌ FAILED: ${name}`);
        console.error(err.message);
        failed++;
      }
    };

    // 1. Health Check
    await test('Health Check API', async () => {
      const res = await request({ path: '/api/health', method: 'GET' });
      if (res.statusCode !== 200) throw new Error(`Status ${res.statusCode}`);
      const data = JSON.parse(res.data);
      if (data.status !== 'ok') throw new Error('Status not ok');
    });

    // 2. Static Files
    await test('Serve index.html', async () => {
      const res = await request({ path: '/', method: 'GET' });
      if (res.statusCode !== 200) throw new Error(`Status ${res.statusCode}`);
      if (!res.data.includes('<title>')) throw new Error('Missing title tag');
    });

    await test('Serve style.css', async () => {
      const res = await request({ path: '/style.css', method: 'GET' });
      if (res.statusCode !== 200) throw new Error(`Status ${res.statusCode}`);
      if (!res.headers['content-type'].includes('css')) throw new Error('Wrong content type');
    });

    // 3. Build Log Filtering
    await test('Filter Build Log API', async () => {
      const body = {
        content: 'Building Project...\nerror C2065: "test": undeclared identifier\nDone.',
        options: { showWarnings: true }
      };
      const res = await request({ 
        path: '/api/filter', 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, body);
      
      if (res.statusCode !== 200) throw new Error(`Status ${res.statusCode}`);
      const data = JSON.parse(res.data);
      if (data.summary.errorCount !== 1) throw new Error(`Expected 1 error, got ${data.summary.errorCount}`);
      if (!data.filteredContent.includes('C2065')) throw new Error('Missing error code in output');
    });

    // 4. Unity Test Results Filtering
    await test('Filter Unity Results API', async () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<test-run id="2" total="1" passed="0" failed="1" skipped="0">
  <test-case name="TestFailure" result="Failed">
    <failure><message><![CDATA[Expected 1 but was 0]]></message></failure>
  </test-case>
</test-run>`;
      
      const res = await request({ 
        path: '/api/filter', 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, { content: xml });
      
      if (res.statusCode !== 200) throw new Error(`Status ${res.statusCode}`);
      const data = JSON.parse(res.data);
      if (data.summary.failed !== 1) throw new Error(`Expected 1 failure, got ${data.summary.failed}`);
      if (!data.filteredContent.includes('TestFailure')) throw new Error('Missing test name in output');
    });

    // 5. MCP Tools Integration
    await test('MCP List Tools', async () => {
      const res = await request({ 
        path: '/mcp', 
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream'
        }
      }, {
        jsonrpc: '2.0',
        method: 'tools/list',
        params: {},
        id: 1
      });
      
      if (res.statusCode !== 200) throw new Error(`Status ${res.statusCode}`);
      if (!res.data.includes('filter_build_log')) throw new Error('Missing tool: filter_build_log');
    });

    // 6. Error Handling
    await test('Handle empty content', async () => {
      const res = await request({ 
        path: '/api/filter', 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, { content: '' });
      
      if (res.statusCode !== 400) throw new Error(`Expected 400, got ${res.statusCode}`);
      const data = JSON.parse(res.data);
      if (data.error !== 'No content provided') throw new Error(`Wrong error message: ${data.error}`);
    });

    console.log(`\n📊 Test Summary: ${passed} passed, ${failed} failed\n`);
    
    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Test Suite Error:', err);
    process.exit(1);
  } finally {
    await stopServer();
  }
}

runTests();