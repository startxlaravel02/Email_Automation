const fs = require("fs");
const path = require("path");
const { authenticate } = require("@google-cloud/local-auth");
const { google } = require("googleapis");

const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];

const TOKEN_PATH = path.join(__dirname, "../../token.json");
const CREDENTIALS_PATH = path.join(__dirname, "../../credentials.json");

async function authorize() {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));

  const { client_secret, client_id, redirect_uris } = credentials.installed;

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0],
  );

  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH));

    oAuth2Client.setCredentials(token);

    return oAuth2Client;
    console.log("Token Loaded:");
    console.log(oAuth2Client.credentials);
  }

  const authClient = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });

  fs.writeFileSync(TOKEN_PATH, JSON.stringify(authClient.credentials, null, 2));

  return authClient;
}

module.exports = authorize;
