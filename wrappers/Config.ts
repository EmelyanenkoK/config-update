import { Op } from './Constants';
import { Address, beginCell, Cell, Contract, ContractProvider, Dictionary, Sender, SendMode, Slice, toNano} from "@ton/core";

export class Config implements Contract {
    constructor(readonly address: Address,readonly init?: { code: Cell; data: Cell}){}

    static createFromAddress(address: Address) {
        return new Config(address);
    }
    async getState(provider: ContractProvider) {
        const { state } = await provider.getState();
        if(state.type !== 'active') {
            throw new Error(`Config is not active: ${state.type}`);
        }
        return {
            code: state.code ? Cell.fromBoc(state.code)[0] : null,
            data: state.data ? Cell.fromBoc(state.data)[0] : null
        }
    }

    async getData(provider: ContractProvider) {
        const state = await this.getState(provider);
        if(!state.data) {
            throw new Error("Config data is not defined!");
        }
        return state.data;
    }

    async getConfig(provider: ContractProvider) {
        const data = await this.getData(provider);
        return Dictionary.loadDirect(Dictionary.Keys.Int(32), Dictionary.Values.Cell(), data.refs[0]);
    }

    async getProposal(provider: ContractProvider, prop_hash: Buffer | bigint) {
        const prop = Buffer.isBuffer(prop_hash) ? BigInt('0x' + prop_hash.toString('hex')) : prop_hash;
        const { stack } = await provider.get('get_proposal', [{ type: 'int', value: prop}]);
        const propTuple = stack.readTupleOpt();

        if(propTuple == null) {
            return propTuple;
        }
        const expires = propTuple.readNumber();
        const critical = propTuple.readBoolean();

        const paramTuple = propTuple.readTuple();

        return {
            expires,
            critical,
            param_id: paramTuple.readNumber(),
            value: paramTuple.readCell()
        }
    }

    static newVotingProposalMessage(proposal: {
        expire_at: number,
        critical: boolean,
        param_id: number,
        value?: Cell,
        cur_hash?: Buffer
    }, query_id: bigint | number = 0) {
        const hashBuilder = beginCell();
        if(Buffer.isBuffer(proposal.cur_hash)) {
            hashBuilder.storeBit(true).storeBuffer(proposal.cur_hash, 32);
        } else {
            hashBuilder.storeBit(false);
        }

        const propCell = beginCell()
                          .storeUint(0xf3, 8) // Tag
                          .storeInt(proposal.param_id, 32)
                          .storeMaybeRef(proposal.value)
                          .storeBuilder(hashBuilder)
                         .endCell();

        return beginCell()
                        .storeUint(Op.newVoting, 32)
                        .storeUint(query_id, 64)
                        .storeUint(proposal.expire_at, 32)
                        .storeBit(proposal.critical)
                        .storeRef(propCell)
                    .endCell()

    }

    static mockVoteMessage(idx: number, propHash: Buffer | bigint, queryId: number | bigint = 0) {
        const voteProp: bigint = Buffer.isBuffer(propHash) ? BigInt('0x' + propHash.toString('hex')) : propHash;

        return beginCell()
                .storeUint(Op.voteForProposal, 32)
                .storeUint(queryId, 64)
                .storeBuffer(Buffer.alloc(64)) // 512 bits mock signature
                .storeUint(0x566f7445, 32) // Sign tag
                .storeUint(idx, 16) // Validator index
                .storeUint(voteProp, 256)
               .endCell();
    }

    static newVsetMessage(vset: Cell, queryId: number | bigint = 0) {
        return beginCell()
                .storeUint(Op.newValidatorsSet, 32)
                .storeUint(queryId, 64)
                .storeRef(vset)
               .endCell();
    }

    static setCustomSlotMessage(param_id: -1024 | -1025, value: Cell, receiver_address: Address,
                                query_id: bigint | number = 0) {
        return beginCell()
                        .storeUint(Op.setCustomSlot, 32)
                        .storeUint(query_id, 64)
                        .storeInt(param_id, 32)
                        .storeAddress(receiver_address)
                        .storeRef(value)
                    .endCell();
    }

    async sendSetCustomSlot(provider: ContractProvider,
                            via: Sender,
                            param_id: -1024 | -1025, param_value: Cell, receiver: Address,
                            value: bigint = toNano('10'),
                            query_id: bigint | number = 0) {

        return await provider.internal(via, {
            body: Config.setCustomSlotMessage(param_id, param_value, receiver, query_id),
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY
        });
    }
}
