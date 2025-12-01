module.exports = {
  getServerSession: jest.fn(async () => ({
    user: { id: "mock-user-id", emailVerified: "" },
  })),
};
