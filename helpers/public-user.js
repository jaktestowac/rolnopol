function toPublicUser(user) {
  if (!user || typeof user !== "object") {
    return user;
  }

  const { password, twoFactorAuth, ...userResponse } = user;
  return userResponse;
}

module.exports = {
  toPublicUser,
};
