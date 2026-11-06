// Keeps the fake providers running for the end-to-end browser test.
import { ready } from './mock_providers.mjs';
await ready;
console.log('mock providers on http://127.0.0.1:9900');
