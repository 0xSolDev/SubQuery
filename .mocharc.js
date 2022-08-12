const moduleAlias = require('module-alias');
if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test'
}
// nodejs doesn't understand rootDirs in tsconfig, use moduleAlias to workaround
moduleAlias.addAlias('./publish', `${__dirname}/publish`);

module.exports = {
    "extension": [
        "ts"
    ],
    "require": ["dotenv/config", "ts-node/register"],
    "timeout": 12000
}
