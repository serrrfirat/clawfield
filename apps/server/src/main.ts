import { SERVER_PORT } from '@clawfield/shared';
import { RoomManager } from './room-manager.js';

const port = parseInt(process.env.PORT || String(SERVER_PORT), 10);

console.log('Clawfield server starting...');
new RoomManager(port);
console.log(`Server running on port ${port}`);
