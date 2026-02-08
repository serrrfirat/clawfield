import { SERVER_PORT } from '@clawfield/shared';
import { GameLoop } from './game-loop.js';

console.log('Clawfield server starting...');
new GameLoop(SERVER_PORT);
console.log(`Server running on port ${SERVER_PORT}`);
