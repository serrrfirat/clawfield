import { SERVER_PORT } from '@clawfield/shared';
import { RoomManager } from './room-manager.js';
import { Server as ColyseusServer } from 'colyseus';
import { BattleRoom } from './colyseus/BattleRoom.js';

const port = parseInt(process.env.PORT || String(SERVER_PORT), 10);
const netcodeBackend = (process.env.NETCODE_BACKEND ?? 'colyseus').toLowerCase();
const useColyseus = netcodeBackend === 'colyseus';

console.log('Clawfield server starting...');
console.log(`Netcode backend: ${netcodeBackend}`);

if (useColyseus) {
  const gameServer = new ColyseusServer({});

  gameServer.define('battle_quick', BattleRoom);
  gameServer.define('battle_lobby', BattleRoom);
  gameServer.listen(port);
  console.log(`[Colyseus] Server running on port ${port}`);
} else {
  new RoomManager(port);
  console.log(`Server running on port ${port}`);
}
