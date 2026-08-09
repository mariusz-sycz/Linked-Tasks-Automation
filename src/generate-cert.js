// Generates a self-signed HTTPS certificate for the local dev server (certs/ is gitignored).
const fs = require("fs");
const path = require("path");
const selfsigned = require("selfsigned");

const certsDir = path.join(__dirname, "certs");
if (!fs.existsSync(certsDir)) {
    fs.mkdirSync(certsDir);
}

const attrs = [{ name: "commonName", value: "localhost" }];
const pems = selfsigned.generate(attrs, {
    days: 3650,
    keySize: 2048,
    extensions: [
        { name: "basicConstraints", cA: false },
        {
            name: "subjectAltName",
            altNames: [
                { type: 2, value: "localhost" },
                { type: 7, ip: "127.0.0.1" }
            ]
        }
    ]
});

fs.writeFileSync(path.join(certsDir, "cert.pem"), pems.cert);
fs.writeFileSync(path.join(certsDir, "key.pem"), pems.private);

console.log("Generated self-signed certificate in " + certsDir);
