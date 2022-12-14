import { expect, use } from "chai";
import { MockProvider, solidity } from "ethereum-waffle";
import { deployContracts } from "./setup";
import { InflationController, SQToken } from "../src";

use(solidity);

describe("SQToken Contract", () => {
    let mockProvider = new MockProvider();
    const [wallet_0, wallet_1] = mockProvider.getWallets();
    let inflationController: InflationController;
    let token: SQToken;

    beforeEach(async () => {
        const deployment = await deployContracts(wallet_0, wallet_1);
        inflationController = deployment.inflationController;
        token = deployment.token;
    });

    describe("Genesis Config", () => {
        it("check genesis config", async () => {
            expect(await token.getMinter()).to.equal(inflationController.address);
            expect(await token.balanceOf(wallet_0.address)).to.equal(
                "10000000000000000000000000000"
            );
        });
    })

    describe("Mint Tokens", () => {
        it("mint with personal wallet should fail", async () => {
            await expect(token.mint(wallet_0.address, 10000000000)).to.be.revertedWith(
                "Not minter"
            );
        })
    });

    describe("Burn Tokens", () => {
        beforeEach(async () => {
            await token.transfer(wallet_1.address, 100000);
        });

        it("burn tokens with current account should work", async () => {
            const balance = await token.balanceOf(wallet_1.address);
            await token.connect(wallet_1).burn(1000);
            expect(
                await token.balanceOf(wallet_1.address)
            ).to.equal(balance.sub(1000));
        });

        it("burn tokens from given account should work", async () => {
            const balance = await token.balanceOf(wallet_1.address);
            await token.connect(wallet_1).approve(wallet_0.address, 1000);
            await token.burnFrom(wallet_1.address, 100);

            expect(await token.allowance(wallet_1.address, wallet_0.address)).to.equal(900);
            expect(await token.balanceOf(wallet_1.address)).to.equal(balance.sub(100));
        });
    });
});
