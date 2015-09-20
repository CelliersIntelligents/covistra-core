

module.exports = function(mongodb) {

  return {
    "validUser1": {
    "_id": mongodb.ObjectId("53d2567f2ddf7700000b8b0e"),
        "username": "testUser1",
        "email": "test1@user.me",
        "token": "valid-test-token"
    },
      "validUser2": {
      "_id": mongodb.ObjectId("53ecec916241680800f2347a"),
          "username": "testUser2",
          "email": "test2@user.me",
          "token": "valid-test-token"
    }
  };

};

