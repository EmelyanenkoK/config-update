
import { Config } from '../wrappers/Config';
import {
  Blockchain,
  BlockchainSnapshot,
  createShardAccount,
  internal,
  SandboxContract,
  TreasuryContract
} from '@ton/sandbox';

import { compile, libraryCellFromCode, sleep } from '@ton/blueprint';
import { Address, beginCell, Cell, Dictionary, ExternalAddress, internal as internal_relaxed, SendMode, toNano, Transaction } from '@ton/core';
import '@ton/test-utils';
import { Op } from '../wrappers/Constants';
import { randomAddress } from '@ton/test-utils';

async function fetchConfigState(address: Address, retryCount:number = 5) {
    do {
        try {
            const headers = new Headers({
                accept: 'application/json'
            });

            const params = new URLSearchParams({
                address: address.toString(),
                include_boc: 'true'
            });

            const resp = await fetch('https://toncenter.com/api/v3/accountStates?' + params, {
                headers
            });

            if(!resp.ok) {
                throw new Error(`Response status ${resp.status}`);
            }

            const jsonResp = await resp.json();
            const configData = jsonResp.accounts[0].data_boc;
            if(!configData) {
                throw new Error(`Data boc ton found: ${JSON.stringify(jsonResp)}`);
            }

            return Cell.fromBase64(configData);
        } catch(e) {
            const errMsg = `Failed to fetch state ${e}`;
            if(--retryCount >= 0) {
                console.error(errMsg);
                await sleep(2000);
            } else {
                throw new Error(errMsg);
            }
        }
    } while(true);
}

const getRandom = (min:number, max:number) => {
    return Math.random() * (max - min) + min;
}

export const getRandomInt = (min: number, max: number) => {
    return Math.round(getRandom(min, max));
}

function differentAddress(address: Address) {
    let newAddress: Address

    do {
        newAddress = randomAddress(address.workChain);
    } while(newAddress.equals(address));

    return newAddress;
}

describe('Config custom slot', () => {
    let blockchain: Blockchain;
    let configContract: SandboxContract<Config>;
    let configCode: Cell;
    let deployer: SandboxContract<TreasuryContract>;

    const configAddress  = Address.parse('Ef9VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVbxn');

    const customSlots: Array<-1024 | -1025> = [-1024, -1025];
    const customSlotAdmin = Address.parse('Ef8zMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzM0vF');

    let initialState: BlockchainSnapshot;

    let assertSlotRejected: (txs: Transaction[], dataBefore: Cell, resp: Address) => Promise<void>;
    let assertParamSet: (paramId: number, data: Cell) => Promise<void>;

    beforeAll(async () => {
        blockchain = await Blockchain.create();

        const configData = await fetchConfigState(configAddress);
        configCode = await compile('Config');

        blockchain.setConfig(configData.refs[0]);

        deployer = await blockchain.treasury('deployer_wallet', {workchain: -1});

        await blockchain.setShardAccount(configAddress, createShardAccount({
            address: configAddress,
            code: configCode,
            data: configData,
            balance: toNano('10000')
        }));

        configContract = blockchain.openContract(
            Config.createFromAddress(configAddress)
        );

        assertSlotRejected = async (txs, data, resp) => {
            expect(txs).toHaveTransaction({
                on: resp,
                from: configContract.address,
                op: Op.customSlotRejected
            });
            expect(await configContract.getData()).toEqualCell(data);
        };

        assertParamSet = async (paramId, data) => {
            const curConfig = await configContract.getConfig();
            expect(curConfig.get(paramId)).toEqualCell(data);
        }

        initialState = blockchain.snapshot();
    });

    beforeEach(async () => await blockchain.loadFrom(initialState));

    it('should be able to set custom slot -1024', async () => {
        const testSlot  = -1024;
        const testCellA = beginCell().storeStringTail("Hop hey La La Ley").endCell();
        const testCellB = beginCell().storeBuffer(testCellA.hash()).endCell();
        for(let testCell of [testCellA, testCellB]) {
            const setSlotMsg = Config.setCustomSlotMessage(testSlot, testCell, deployer.address);
            const configSlotBefore = (await configContract.getConfig()).get(testSlot);

            expect(configSlotBefore === undefined || (!configSlotBefore.equals(testCell))).toBe(true);

            const res = await blockchain.sendMessage(internal({
                to: configContract.address,
                from: customSlotAdmin,
                body: setSlotMsg,
                value: toNano('10'),
            }));

            expect(res.transactions).toHaveTransaction({
                on: deployer.address,
                from: configContract.address,
                op: Op.customSlotAccepted
            });

            await assertParamSet(testSlot, testCell);
        }
    });

    it('only admin should be able to set slots', async () => {
        let testSenders = [deployer.address, randomAddress(0), new Address(0, customSlotAdmin.hash), differentAddress(customSlotAdmin)];

        for(let testSlot of customSlots) {
            for(let testAddr of testSenders) {
                const testCell  = beginCell().storeAddress(testAddr).endCell();
                const dataBefore = await configContract.getData();
                const res = await configContract.sendSetCustomSlot(blockchain.sender(testAddr), testSlot, testCell, deployer.address);

                if(testAddr.workChain == -1) {
                    await assertSlotRejected(res.transactions, dataBefore, deployer.address);
                } else {
                    // Config ignores operations for 0 workchain
                    expect(dataBefore).toEqualCell(await configContract.getData());
                }
            }
        }
    });


    it('should be able to set custom slot -1025', async () => {
        const testSlot  = -1025;
        const testCellA = beginCell().storeStringTail("Hop hey La La Ley").endCell();
        const testCellB = beginCell().storeBuffer(testCellA.hash()).endCell();
        for(let testCell of [testCellA, testCellB]) {
            const setSlotMsg = Config.setCustomSlotMessage(testSlot, testCell, deployer.address);
            const configSlotBefore = (await configContract.getConfig()).get(testSlot);

            expect(configSlotBefore === undefined || (!configSlotBefore.equals(testCell))).toBe(true);

            const res = await blockchain.sendMessage(internal({
                to: configContract.address,
                from: customSlotAdmin,
                body: setSlotMsg,
                value: toNano('10'),
            }));

            expect(res.transactions).toHaveTransaction({
                on: deployer.address,
                from: configContract.address,
                op: Op.customSlotAccepted
            });

            await assertParamSet(testSlot, testCell);
        }
    });
    it('should bounce set_custom_slot when response address is not standard', async () => {
        const testCell = beginCell().storeStringTail("Hop hey La La Ley").endCell();
        let testCases  = [null, new ExternalAddress(42n, 256)] as unknown as Address[];
        const testPayloads: Cell[] = [];

        /*
         * addr_var$11 anycast:(Maybe Anycast) addr_len:(## 9)
         * workchain_id:int32 address:(bits addr_len) = MsgAddressInt;
         */

        customSlots.forEach(slot => {
            const varAddressPayload = beginCell()
                                        .storeUint(Op.setCustomSlot, 32)
                                        .storeUint(0, 64) // queryId
                                        .storeInt(slot, 32) // param_id
                                        .storeUint(0b110, 3) // var_addr tag + no anycast
                                        .storeUint(256, 9) // addr_len
                                        .storeUint(0, 32) // workchain
                                        .storeUint(42n, 256) // Address
                                        .storeRef(testCell)
                                    .endCell();
            testPayloads.push(...testCases.map(a => Config.setCustomSlotMessage(slot, testCell, a)), varAddressPayload);
        });

        for(let setSlotMsg of testPayloads ) {

            const res = await blockchain.sendMessage(internal({
                to: configContract.address,
                from: customSlotAdmin,
                body: setSlotMsg,
                value: toNano('10'),
            }));

            expect(res.transactions).toHaveTransaction({
                on: configContract.address,
                op: Op.setCustomSlot,
                aborted: true,
                outMessagesCount: 1 // Should bounce
            });
            expect(res.transactions).toHaveTransaction({
                on: customSlotAdmin,
                from: configContract.address,
                inMessageBounced: true
            });
        }
    });
    it('should not allow more than single cell for custom slot', async () => {
        // Exact same cell that worked, but in ref
        const testCell = beginCell().storeStringRefTail("Hop hey La La Ley").endCell();

        for(let testSlot of customSlots) {
            const dataBefore = await configContract.getData();
            const res = await configContract.sendSetCustomSlot(blockchain.sender(customSlotAdmin), testSlot,testCell, deployer.address);
            await assertSlotRejected(res.transactions, dataBefore, deployer.address);
        }
    });
    it('should not allow to set other parameters', async () => {
        const testCell = beginCell().storeStringTail("Hop hey La La Ley").endCell();

        let testParams = [
            new Array(5).fill(0).map(p => getRandomInt(1, 81)),
            new Array(5).fill(0).map(p => getRandomInt(-1023, -1)),
            -94
        ].flat();

        for(let testParam of testParams) {
            const dataBefore = await configContract.getData();
            // Force typecast
            const res = await configContract.sendSetCustomSlot(blockchain.sender(customSlotAdmin), testParam as -1024 | -1025,testCell, deployer.address);
            await assertSlotRejected(res.transactions, dataBefore, deployer.address);
        }
    });
    it('should not accept exotic cells for custom slot', async () => {
        const testCell = beginCell().storeStringTail("Hop hey La La Ley").endCell();

        // Gotta make library available, so config won't thrown on XCTOS
        const _libs = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.Cell());
        _libs.set(BigInt(`0x${testCell.hash().toString('hex')}`), testCell);
        const libs = beginCell().storeDictDirect(_libs).endCell();
        blockchain.libs = libs;

        let testLib = libraryCellFromCode(testCell);
        expect(testLib.isExotic).toBe(true);

        let testProofPrep = beginCell().storeUint(3, 8) // Merkle proof
                                       .storeBuffer(testCell.hash()) // Hash
                                       .storeUint(testCell.depth(), 16)
                                       .storeRef(testCell)
                            .endCell();
        const testProof = new Cell({ exotic:true, bits: testProofPrep.bits, refs:testProofPrep.refs});

        const testUpdatePrep = beginCell().storeUint(4, 8) // Merkle update
                                          /* In reality this update does nothing,
                                           * since both proofs are equal
                                           * but nevertheless it is a valid update
                                           */
                                          .storeBuffer(testProof.hash(0))
                                          .storeBuffer(testProof.hash(0))
                                          .storeUint(testProof.depth(0), 16)
                                          .storeUint(testProof.depth(0), 16)
                                          .storeRef(testProof)
                                          .storeRef(testProof)
                               .endCell();
        const testUpdate = new Cell({ exotic:true, bits: testUpdatePrep.bits, refs:testUpdatePrep.refs});


        for(let testSlot of customSlots) {
            for(let testPayload of [testLib, testProof, testUpdate]) {
                const dataBefore = await configContract.getData();
                const res = await configContract.sendSetCustomSlot(blockchain.sender(customSlotAdmin), testSlot, testPayload, deployer.address);
                await assertSlotRejected(res.transactions, dataBefore, deployer.address);
            }
        }
    });

    it('should not allow to create proposals for parameters -1024 and -1025', async () => {
        const testCell = beginCell().storeStringTail("Hop hey La La Ley").endCell();

        let rndParams = [
            new Array(5).fill(0).map(p => getRandomInt(10, 81)),
            new Array(5).fill(0).map(p => getRandomInt(-1023, -1)),
            -94
        ].flat();

        let curConfig = await configContract.getConfig();
        const critParams = Dictionary.loadDirect(Dictionary.Keys.Int(32), Dictionary.Values.BitString(0), curConfig.get(10)!);

        const testCreateVoting = async (testParams: number[], expectOp: number) => {
            for(let paramId of testParams) {
                let curHash: Buffer;
                const curParam = curConfig.get(paramId);

                if(curParam) {
                    curHash = curParam.hash();
                } else {
                    curHash = Buffer.alloc(32);
                }

                const propMsg  = Config.newVotingProposalMessage({
                    expire_at: Math.floor(Date.now() / 1000) + 3600 * 24 * 60,
                    critical: critParams.has(paramId),
                    param_id: paramId,
                    value: testCell,
                    cur_hash: curHash
                });

                expect(await configContract.getProposal(propMsg.refs[0].hash())).toBeNull();

                const dataBefore = await configContract.getData();

                const res = await deployer.send({
                    to: configContract.address,
                    value: toNano('100'),
                    body: propMsg,
                    sendMode: SendMode.PAY_GAS_SEPARATELY
                });

                expect(res.transactions).toHaveTransaction({
                    on: configContract.address,
                    op: Op.newVoting,
                    aborted: false,
                    outMessagesCount: 1
                });

                if(expectOp == Op.newVotingCreated) {
                    expect(await configContract.getProposal(propMsg.refs[0].hash())).not.toBeNull();
                    expect(res.transactions).toHaveTransaction({
                        on: deployer.address,
                        from: configContract.address,
                        op: Op.newVotingCreated
                    });
                } else {
                    const dataAfter = await configContract.getData();
                    expect(dataBefore).toEqualCell(dataAfter);

                    expect(res.transactions).toHaveTransaction({
                        on: deployer.address,
                        from: configContract.address,
                        op: expectOp
                    });

                }
            }
        }

        // Check that voting creating at least works
        await testCreateVoting(rndParams, Op.newVotingCreated);

        // Check that voting is not created when parameters are not set
        expect(curConfig.get(-1024)).toBeUndefined();
        expect(curConfig.get(-1025)).toBeUndefined();

        await testCreateVoting(customSlots, Op.customSlotVotingRejected);

        for(let slot of customSlots) {
            const curCell = beginCell().storeInt(slot, 32).storeBuffer(testCell.hash()).endCell();
            const setSlotMsg = Config.setCustomSlotMessage(slot, curCell, deployer.address);

            await blockchain.sendMessage(internal({
                from: customSlotAdmin,
                to: configContract.address,
                body: setSlotMsg,
                value: toNano('10')
            }));

            await assertParamSet(slot, curCell);
        }

        // Now custom slots are set
        // Test that it won't allow to start voting now
        await testCreateVoting(customSlots, Op.customSlotVotingRejected);

    });
});
