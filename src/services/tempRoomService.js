const tempRooms = require('../utils/tempRooms');

module.exports = {
  getRoom: tempRooms.getRoom,
  setRoom: tempRooms.setRoom,
  deleteRoom: tempRooms.deleteRoom,
  getRoomByOwner: tempRooms.getRoomByOwner,
  defaultRoomData: tempRooms.defaultRoomData,
};
