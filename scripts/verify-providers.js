// scripts/verify-providers.js
// Automated verification runner for Audion 1.5.0 sample provider plugins

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');

console.log('🧪 Starting Audion Provider Verification Runner...\n');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
  }
}

// ── Mock Audion Plugin API Environment ──
class MockAudionApi {
  constructor(pluginName) {
    this.pluginName = pluginName;
    this.registeredStreamProviders = [];
    this.registeredMetadataProviders = [];
    this.registeredLyricsProviders = [];

    this.stream = {
      registerProvider: (provider) => {
        this.registeredStreamProviders.push(provider);
      }
    };

    this.metadata = {
      registerProvider: (provider) => {
        this.registeredMetadataProviders.push(provider);
      }
    };

    this.lyrics = {
      registerProvider: (provider) => {
        this.registeredLyricsProviders.push(provider);
      }
    };

    this.fetch = async (url, opts) => {
      return await fetch(url, opts);
    };

    this.fetchBlob = async (url, mime) => {
      return `blob:audion-mock/${Date.now()}`;
    };
  }
}

async function run() {
  // ── Test 1: Verify sample-stream-provider ──
  console.log('📦 1. Verifying Sample Stream Provider...');
  const streamProviderModule = await import('../plugin-examples/sample-stream-provider/index.js');
  const streamProvider = streamProviderModule.default || globalThis.SampleStreamProvider;

  assert(streamProvider !== undefined, 'SampleStreamProvider object exported');
  assert(streamProvider.id === 'sample-stream-provider', 'Provider ID is sample-stream-provider');
  assert(typeof streamProvider.init === 'function', 'init(api) function exists');
  assert(typeof streamProvider.getStream === 'function', 'getStream(songId, quality) function exists');

  const streamApi = new MockAudionApi('sample-stream-provider');
  await streamProvider.init(streamApi);
  assert(streamApi.registeredStreamProviders.length === 1, 'StreamProvider registered into api.stream');

  // Test format picker and quality options
  console.log('   Testing quality tiers format logic...');
  const testFormats = [
    { mimeType: 'audio/webm', bitrate: 160000, url: 'https://example.com/audio-high.webm' },
    { mimeType: 'audio/mp4', bitrate: 128000, url: 'https://example.com/audio-med.m4a' },
    { mimeType: 'audio/webm', bitrate: 70000, url: 'https://example.com/audio-low.webm' }
  ];
  const pickedHigh = streamProvider._pickFormatByQuality(testFormats, 'high');
  const pickedStandard = streamProvider._pickFormatByQuality(testFormats, 'standard');
  const pickedLow = streamProvider._pickFormatByQuality(testFormats, 'low');
  assert(pickedHigh && pickedHigh.bitrate === 160000, 'Quality "high" selected 160kbps stream');
  assert(pickedStandard && pickedStandard.bitrate === 128000, 'Quality "standard" selected 128kbps stream');
  assert(pickedLow && pickedLow.bitrate === 70000, 'Quality "low" selected 70kbps stream');

  // Test getStream fallback on empty / invalid input
  const emptyRes = await streamProvider.getStream('');
  assert(emptyRes === null, 'Empty songId safely returns null');

  // Test full-stream resolveByQuery
  console.log('   Testing resolveByQuery for cross-provider stream handoff...');
  try {
    const fullStream = await streamProvider.resolveByQuery({ title: 'One More Time', artist: 'Daft Punk' }, 'high');
    if (fullStream && fullStream.url) {
      assert(typeof fullStream.url === 'string' && fullStream.url.length > 0, `Full stream resolved (${fullStream.format || 'audio'})`);
      assert(typeof fullStream.bitrate === 'number', `Stream bitrate: ${fullStream.bitrate} bps`);
    } else {
      console.log('   (Full stream resolution skipped or network throttled)');
    }
  } catch (err) {
    console.warn('   ⚠️ resolveByQuery test skipped:', err.message);
  }

  // ── Test 2: Verify sample-metadata-provider ──
  console.log('\n📦 2. Verifying Sample Metadata Provider...');
  const metadataProviderModule = await import('../plugin-examples/sample-metadata-provider/index.js');
  const metadataProvider = metadataProviderModule.default || globalThis.SampleMetadataProvider;

  assert(metadataProvider !== undefined, 'SampleMetadataProvider object exported');
  assert(metadataProvider.id === 'sample-metadata-provider', 'Provider ID is sample-metadata-provider');
  assert(typeof metadataProvider.search === 'function', 'search(query, type, page) function exists');

  const metadataApi = new MockAudionApi('sample-metadata-provider');
  await metadataProvider.init(metadataApi);
  assert(metadataApi.registeredMetadataProviders.length === 1, 'MetadataProvider registered into api.metadata');

  // Test live search query against open iTunes API
  console.log('   Executing search("Daft Punk", "track")...');
  try {
    const searchRes = await metadataProvider.search('Daft Punk', 'track');
    assert(searchRes && Array.isArray(searchRes.tracks), 'search() returns tracks array');

    if (searchRes.tracks.length > 0) {
      assert(searchRes.tracks.length > 0, `search() returned ${searchRes.tracks.length} tracks`);
      const first = searchRes.tracks[0];
      assert(typeof first.title === 'string' && first.title.length > 0, `Track has title: "${first.title}"`);
      assert(typeof first.artist === 'string' && first.artist.length > 0, `Track has artist: "${first.artist}"`);
      assert(typeof first.duration === 'number' && first.duration > 0, `Track has duration: ${first.duration}s`);
      assert(first.cover_url && first.cover_url.includes('1000x1000'), 'Track cover upgraded to 1000x1000 high-res');
    } else {
      console.log('   (Network metadata search skipped or network throttled)');
    }
  } catch (err) {
    console.warn('   ⚠️ Network search skipped:', err.message);
  }

  // ── Test 3: Verify sample-lyrics-provider ──
  console.log('\n📦 3. Verifying Sample Lyrics Provider...');
  const lyricsProviderModule = await import('../plugin-examples/sample-lyrics-provider/index.js');
  const lyricsProvider = lyricsProviderModule.default || globalThis.SampleLyricsProvider;

  assert(lyricsProvider !== undefined, 'SampleLyricsProvider object exported');
  assert(lyricsProvider.id === 'sample-lyrics-provider', 'Provider ID is sample-lyrics-provider');
  assert(typeof lyricsProvider.getLyrics === 'function', 'getLyrics(track) function exists');

  const lyricsApi = new MockAudionApi('sample-lyrics-provider');
  await lyricsProvider.init(lyricsApi);
  assert(lyricsApi.registeredLyricsProviders.length === 1, 'LyricsProvider registered into api.lyrics');

  // Test LRC line & syllable parser
  console.log('   Testing LRC parser with timestamps and syllable tags...');
  const testLrc = `[00:12.34] Hello world\n[00:15.67] <00:15.67> Syllable <00:16.10> Karaoke <00:16.80> Sync`;
  const parsed = lyricsProvider._parseLrc(testLrc);
  assert(parsed.lines.length === 2, `Parsed exactly 2 lyric lines (got ${parsed.lines.length})`);
  assert(Math.abs(parsed.lines[0].time - 12.34) < 0.01, `Line 1 time correctly parsed as 12.34s`);
  assert(parsed.lines[0].text === 'Hello world', `Line 1 text correctly extracted as "Hello world"`);
  assert(parsed.hasWordSync === true, 'Parser detected enhanced syllable/word sync tags');
  assert(parsed.lines[1].words && parsed.lines[1].words.length === 3, 'Line 2 parsed 3 word timing tokens');

  // Test live lyrics lookup against LRCLIB API
  console.log('   Executing getLyrics("Get Lucky", "Daft Punk")...');
  try {
    const lyricsRes = await lyricsProvider.getLyrics({ title: 'Get Lucky', artist: 'Daft Punk' });
    if (lyricsRes) {
      assert(Array.isArray(lyricsRes.lines), 'Lyrics returned array of lines');
      assert(lyricsRes.lines.length > 0, `Returned ${lyricsRes.lines.length} synced lyric lines`);
      assert(typeof lyricsRes.lines[0].time === 'number', `First line time is number (${lyricsRes.lines[0].time}s)`);
      assert(lyricsRes.source === 'lrclib', 'Source identified as lrclib');
    } else {
      console.log('   (LRCLIB returned null or empty for test track)');
    }
  } catch (err) {
    console.warn('   ⚠️ Network lyrics lookup skipped:', err.message);
  }

  // ── Results Summary ──
  console.log(`\n========================================`);
  console.log(`Total Checks: ${totalTests}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${totalTests - passedTests}`);
  console.log(`========================================`);

  if (passedTests === totalTests) {
    console.log('\n✨ All Provider Verification Checks Succeeded!\n');
    process.exit(0);
  } else {
    console.error('\n❌ Some Provider Checks Failed.\n');
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal runner error:', err);
  process.exit(1);
});
