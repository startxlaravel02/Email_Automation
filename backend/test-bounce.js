require("dotenv").config();
const { sendTracked } = require("./src/services/trackingService");
(async () => {
  const r = await sendTracked({
    to: "no-such-user-9z8x7y6w@gmail.com",
    subject: "bounce test",
    body: "This message should bounce.",
  });
  console.log("sent:", r);
  process.exit(0);
})();
