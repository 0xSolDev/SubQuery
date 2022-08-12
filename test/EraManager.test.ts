import {expect, use} from 'chai';
import {MockProvider, solidity} from 'ethereum-waffle';
import {deployContracts} from './setup';
import {timeTravel} from './helper';
import {EraManager} from '../src';
const {time} = require('@openzeppelin/test-helpers');

use(solidity);

describe('Era Manager Contract', () => {
    let mockProvider = new MockProvider();
    const [wallet_0, wallet_1] = mockProvider.getWallets();
    let eraManager: EraManager;

    beforeEach(async () => {
        const deployment = await deployContracts(wallet_0, wallet_1);
        eraManager = deployment.eraManager;
    });

    describe('Start new era', () => {
        it('check default config', async () => {
            // check default era values
            expect(await eraManager.eraPeriod()).to.equal(time.duration.days(1).toNumber());
            expect(await eraManager.eraNumber()).to.equal(0);
            expect(await eraManager.eraStartTime()).to.equal(0);
        });

        it('start new era should work', async () => {
            // start new era
            expect(await eraManager.startNewEra())
                .to.be.emit(eraManager, 'NewEraStart')
                .withArgs(1, wallet_0.address);

            // check updates
            expect(await eraManager.eraNumber()).to.equal(1);
            expect(Number(await eraManager.eraStartTime())).to.greaterThanOrEqual(0);
        });

        it('start new era with active era should failed', async () => {
            // start new era
            await eraManager.startNewEra();
            // try to start new era again
            await expect(eraManager.startNewEra()).to.be.revertedWith('Current era is still active');
        });
    });

    describe('Update era', () => {
        it('update era period should work', async () => {
            // update era period
            expect(await eraManager.updateEraPeriod(10))
                .to.be.emit(eraManager, 'EraPeriodUpdate')
                .withArgs(0, 10);
            // check updates
            expect(await eraManager.eraPeriod()).to.equal(10);
        });

        it('safe update era should work', async () => {
            // safe update era
            await eraManager.safeUpdateAndGetEra();
            expect(await eraManager.eraNumber()).to.equal(1);
            await eraManager.safeUpdateAndGetEra();
            expect(await eraManager.eraNumber()).to.equal(1);

            // Safe update era after era preriod changed should work
            await eraManager.updateEraPeriod(time.duration.days(1).toNumber());
            await timeTravel(mockProvider, time.duration.days(2).toNumber());
            await eraManager.safeUpdateAndGetEra();
            expect(await eraManager.eraNumber()).to.equal(2);
        });
    });
});
