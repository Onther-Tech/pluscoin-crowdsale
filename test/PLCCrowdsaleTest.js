import ether from "./helpers/ether";
import { advanceBlock } from "./helpers/advanceToBlock";
import { increaseTimeTo, duration } from "./helpers/increaseTime";
import latestTime from "./helpers/latestTime";
import EVMThrow from "./helpers/EVMThrow";
import { capture, restore } from "./helpers/snapshot";
import moment from "moment";

const BigNumber = web3.BigNumber;
const eth = web3.eth;

const should = require("chai")
  .use(require("chai-as-promised"))
  .use(require("chai-bignumber")(BigNumber))
  .should();

const KYC = artifacts.require("KYC.sol");
const PLCCrowdsale = artifacts.require("PLCCrowdsale.sol");
const PLC = artifacts.require("PLC.sol");
const RefundVault = artifacts.require("crowdsale/RefundVault.sol");
const MultiSig = artifacts.require("wallet/MultiSigWallet.sol");

contract(
  "PLCCrowdsale",
  async (
    [
      owner,
      _,
      investor,
      reserveWallet0,
      reserveWallet1,
      reserveWallet2,
      reserveWallet3,
      reserveWallet4,
      ...accounts
    ],
  ) => {
    let snapshotId;

    let kyc, multiSig, crowdsale, token, vault;

    let now, startTime, endTime;
    let beforeStartTime, afterEndTime, afterStartTime;

    let firstBonusDeadline, secondBonusDeadline, thirdBonusDeadline, fourthBonusDeadline;
    let startDate;

    let timelines, presaleRate, rates;

    let maxGuaranteedLimit, maxCallFrequency;
    let maxEtherCap, minEtherCap, _maxEtherCap, _minEtherCap;

    let reserveWallet;

    const newTokenOwner = "0x01ad78dbd65579882a7058bc19b104103627a2ff";

    before(async () => {
      reserveWallet = [
        reserveWallet0,
        reserveWallet1,
        reserveWallet2,
        reserveWallet3,
        reserveWallet4,
      ];

      startTime = moment.utc("2017-09-26").unix();
      startDate = moment.utc("2017-09-26");
      endTime = moment.utc("2017-10-10").unix();

      firstBonusDeadline = startDate.add(1, "day").unix();
      secondBonusDeadline = startDate.add(2, "day").unix();
      thirdBonusDeadline = startDate.add(3, "day").unix();
      fourthBonusDeadline = startDate.add(3, "day").unix();

      timelines = [
        startTime,
        firstBonusDeadline,
        secondBonusDeadline,
        thirdBonusDeadline,
        fourthBonusDeadline,
        endTime,
      ];

      presaleRate = {};
      presaleRate[ investor ] = 500;

      rates = [ 240, 230, 220, 210, 200 ];

      maxGuaranteedLimit = ether(5000);
      maxCallFrequency = 20;

      maxEtherCap = ether(100000);
      minEtherCap = ether(30000);

      // deploy contracts
      kyc = await KYC.new();
      console.log("kyc deployed at", kyc.address);

      multiSig = await MultiSig.new(reserveWallet, reserveWallet.length - 1); // 4 out of 5
      console.log("multiSig deployed at", multiSig.address);

      token = await PLC.new();
      console.log("token deployed at", token.address);

      vault = await RefundVault.new(multiSig.address, reserveWallet);
      console.log("vault deployed at", vault.address);

      crowdsale = await PLCCrowdsale.new(
        kyc.address,
        token.address,
        vault.address,
        multiSig.address,
        reserveWallet,
        timelines,
        maxEtherCap,
        minEtherCap,
      );
      console.log("crowdsale deployed at", crowdsale.address);

      await token.transferOwnership(crowdsale.address);
      await vault.transferOwnership(crowdsale.address);

      // backup
      snapshotId = await capture();

      now = moment().unix();

      beforeStartTime = startTime - duration.seconds(100);
      afterStartTime = startTime + duration.seconds(1);
      afterEndTime = endTime + duration.seconds(1);

      console.log(`
------------------------------

\t[TIME]
startTime:\t\t${ startTime }
firstBonusDeadline:\t${ firstBonusDeadline }
secondBonusDeadline:\t${ secondBonusDeadline }
thirdBonusDeadline:\t${ thirdBonusDeadline }
fourthBonusDeadline:\t${ fourthBonusDeadline }
endTime:\t\t${ endTime }

beforeStartTime:\t${ beforeStartTime }
afterStartTime:\t\t${ afterStartTime }
afterEndTime:\t\t${ afterEndTime }

now:\t\t\t${ now }

------------------------------
`);
    });

    beforeEach(async () => {
      // restore
      await restore(snapshotId);

      // backup
      snapshotId = await capture();

      // proceed 20 block
      for (const i of Array(20)) {
        await advanceBlock();
      }
    });

    describe("Crowdsale", async () => {
      // before start
      it("should reject payments before start", async () => {
        await increaseTimeTo(beforeStartTime);

        await kyc.register(investor)
          .should.be.fulfilled;

        await crowdsale.send(ether(1))
          .should.be.rejectedWith(EVMThrow);

        await crowdsale
          .buyTokens({ from: investor, value: ether(1) })
          .should.be.rejectedWith(EVMThrow);
      });

      it("register presale", async () => {
        const registerPresaleTx = await crowdsale.registerPresale(
          investor,
          ether(5000),
          presaleRate[ investor ],
          false,
        ).should.be.fulfilled;
        console.log("registerPresale Gas Used :", registerPresaleTx.receipt.gasUsed);
      });

      it("register deferred presale", async () => {
        await crowdsale.registerPresale(
          investor,
          ether(5000),
          presaleRate[ investor ],
          true,
        ).should.be.fulfilled;
      });

      // Presale
      it("should buy presaled amount", async () => {
        const presaledAmount = ether(5000);
        const investedAmount = ether(6000);

        await crowdsale.registerPresale(
          investor,
          presaledAmount,
          presaleRate[ investor ],
          false,
        ).should.be.fulfilled;

        const balanceBeforeInvest = await eth.getBalance(investor);

        const buyPresaleTokensTx = await crowdsale.buyPresaleTokens(investor, {
          value: investedAmount,
          from: investor,
        }).should.be.fulfilled;

        console.log("buyPresaleTokens Gas Used :", buyPresaleTokensTx.receipt.gasUsed);
        const balanceAfterInvest = await eth.getBalance(investor);
        const expectedTokenAmount = presaledAmount.mul(presaleRate[ investor ]);

        (await token.balanceOf(investor))
          .should.be.bignumber.equal(expectedTokenAmount);

        (await token.totalSupply())
          .should.be.bignumber.equal(expectedTokenAmount);
        (balanceBeforeInvest - balanceAfterInvest).should.be.within(
          presaledAmount.toNumber(),
          presaledAmount.add(ether(1)).toNumber(),
        );
      });

      it("should buy deferred presaled amount and burn remains", async () => {
        const presaledAmount = maxEtherCap;
        const investedAmount = ether(4000);

        const rate = presaleRate[ investor ];

        await crowdsale.registerPresale(
          investor,
          presaledAmount,
          rate,
          true,
        ).should.be.fulfilled;

        const balanceBeforeInvest = await eth.getBalance(investor);
        const crowdsaleTokenBalance1 = await token.balanceOf(crowdsale.address);

        const buyDeferredPresaleTokensTx = await crowdsale.buyDeferredPresaleTokens(investor, {
          value: investedAmount,
          from: investor,
        }).should.be.fulfilled;

        console.log("buyDeferredPresaleTokensTx Gas Used :", buyDeferredPresaleTokensTx.receipt.gasUsed);

        const balanceAfterInvest = await eth.getBalance(investor);
        const crowdsaleTokenBalance2 = await token.balanceOf(crowdsale.address);
        const expectedUserTokenAmount = investedAmount.mul(rate);
        const expectedTokenTotalSupply = presaledAmount.mul(rate);

        (await token.balanceOf(investor))
          .should.be.bignumber.equal(expectedUserTokenAmount);

        (await token.totalSupply())
          .should.be.bignumber.equal(expectedTokenTotalSupply);

        // ether balance of investor
        (balanceBeforeInvest - balanceAfterInvest).should.be.within(
          investedAmount.toNumber(),
          investedAmount.add(ether(1)).toNumber(),
        );

        // token balance of crowdsale
        (crowdsaleTokenBalance1.sub(crowdsaleTokenBalance2))
          .should.be.bignumber.equal(expectedUserTokenAmount);

        const finalizeTx = await crowdsale.finalize()
          .should.be.fulfilled;

        console.log("finalizeTx Gas Used :", finalizeTx.receipt.gasUsed);
        // burn
        const burnUnpaidTokensTx = await crowdsale.burnUnpaidTokens()
          .should.be.fulfilled;

        console.log("burnUnpaidTokensTx Gas Used :", burnUnpaidTokensTx.receipt.gasUsed);
        (await token.balanceOf(crowdsale.address))
          .should.be.bignumber.equal(0);
      });

      // after start
      it("should reject unregistered payments during the sale", async () => {
        await increaseTimeTo(afterStartTime);

        const investmentAmount = ether(1);

        await crowdsale.buyTokens({
          value: investmentAmount,
          from: investor,
        }).should.be.rejectedWith(EVMThrow);
      });

      it("should accept registered payments during the sale", async () => {
        const investmentAmount = ether(1);
        const rate = rates[ 0 ];
        const expectedTokenAmount = investmentAmount.mul(rate);

        const registerTx = await kyc.register(investor)
          .should.be.fulfilled;

        console.log("registerTx Gas Used :", registerTx.receipt.gasUsed);

        const buyTokensTx = await crowdsale.buyTokens({
          value: investmentAmount,
          from: investor,
        }).should.be.fulfilled;

        console.log("buyTokensTx Gas Used :", buyTokensTx.receipt.gasUsed);

        (await token.balanceOf(investor))
          .should.be.bignumber.equal(expectedTokenAmount);
        (await token.totalSupply())
          .should.be.bignumber.equal(expectedTokenAmount);
      });

      it("should mint following rate for each stage", async () => {
        const investmentAmount = ether(1);
        let expectedTokenAmount = new BigNumber(0);

        await kyc.register(investor)
          .should.be.fulfilled;

        for (let i = 0; i < 5; i++) {
          await increaseTimeTo(timelines[ i + 1 ] - 100);
          const rate = rates[ i ];

          expectedTokenAmount = expectedTokenAmount.add(investmentAmount.mul(rate));

          // proceed 20 block
          for (const i of Array(20)) {
            await advanceBlock();
          }

          await crowdsale.buyTokens({
            value: investmentAmount,
            from: investor,
          }).should.be.fulfilled;

          (await token.balanceOf(investor))
            .should.be.bignumber.equal(expectedTokenAmount);
          (await token.totalSupply())
            .should.be.bignumber.equal(expectedTokenAmount);
        }
      });

      it("should reject payments over 5000 ether", async () => {
        const investmentAmount = ether(5001);

        const balanceBeforeInvest = await eth.getBalance(investor);

        const rate = await crowdsale.getRate();
        const expectedTokenAmount = maxGuaranteedLimit.mul(rate);

        await kyc.register(investor)
          .should.be.fulfilled;

        await crowdsale.buyTokens({
          value: investmentAmount,
          from: investor,
        }).should.be.fulfilled;

        const balanceAfterInvest = await eth.getBalance(investor);

        // toReturn
        (balanceBeforeInvest - balanceAfterInvest).should.be.within(
          ether(5000).toNumber(),
          ether(5001).toNumber(),
        );

        // toFund
        (await token.balanceOf(investor))
          .should.be.bignumber.equal(expectedTokenAmount);
        (await token.totalSupply())
          .should.be.bignumber.equal(expectedTokenAmount);
      });

      it("should reject frequent payments in 20 blocks", async () => {
        const investmentAmount = ether(1);

        await kyc.register(investor)
          .should.be.fulfilled;

        await crowdsale.buyTokens({
          value: investmentAmount,
          from: investor,
        }).should.be.fulfilled;

        await crowdsale
          .buyTokens({
            value: investmentAmount,
            from: investor,
          })
          .should.be.rejectedWith(EVMThrow);
      });

      it("should reject when maxEtherCap reached", async () => {
        // 20 accounts, total 100,000 ether
        for (const account of accounts.slice(0, 20)) {
          await kyc.register(account)
            .should.be.fulfilled;

          await crowdsale.buyTokens({
            value: ether(5000),
            from: account,
          }).should.be.fulfilled;
        }

        const investmentAmount = ether(1);

        await kyc.register(investor)
          .should.be.fulfilled;

        await crowdsale
          .buyTokens({
            value: investmentAmount,
            from: investor,
          })
          .should.be.rejectedWith(EVMThrow);
      });

      it("should accept toFund and return toReturn", async () => {
        const rate = await crowdsale.getRate();
        const investmentAmount = ether(101);

        // 20 accounts, total 99,900 ether
        for (const account of accounts.slice(0, 20)) {
          await kyc.register(account)
            .should.be.fulfilled;

          await crowdsale.buyTokens({
            value: ether(4995),
            from: account,
          }).should.be.fulfilled;
        }

        const balanceBeforeInvest = await eth.getBalance(investor);

        const beforeTokenAmount = ether(99900).mul(rate);
        const expectedTokenAmount = ether(100).mul(rate);

        await kyc.register(investor)
          .should.be.fulfilled;

        await crowdsale.buyTokens({
          value: investmentAmount,
          from: investor,
        }).should.be.fulfilled;

        const balanceAfterInvest = await eth.getBalance(investor);

        // toReturn
        (balanceBeforeInvest - balanceAfterInvest).should.be.within(
          ether(100).toNumber(),
          ether(101).toNumber(),
        );

        // toFund
        (await token.balanceOf(investor)).should.be.bignumber.equal(expectedTokenAmount);
        (await token.totalSupply()).should.be.bignumber.equal(
          beforeTokenAmount.add(expectedTokenAmount),
        );
      });

      it("can finalized during the sale (maxReached)", async () => {
        const investmentAmount = ether(5000);

        // 20 accounts, total 100,000 ether
        for (const account of accounts.slice(0, 20)) {
          await kyc.register(account)
            .should.be.fulfilled;

          await crowdsale.buyTokens({
            value: investmentAmount,
            from: account,
          }).should.be.fulfilled;
        }

        const vaultAddress = await crowdsale.vault();

        (await crowdsale.weiRaised())
          .should.be.bignumber.equal(maxEtherCap);

        (await eth.getBalance(vaultAddress))
          .should.be.bignumber.equal(maxEtherCap);

        await crowdsale.finalize()
          .should.be.fulfilled;
      });

      it("should reject payments after finalized", async () => {
        const investmentAmount = ether(5000);

        // 20 accounts, total 100,000 ether
        for (const account of accounts.slice(0, 20)) {
          await kyc.register(account)
            .should.be.fulfilled;

          await crowdsale.buyTokens({
            value: investmentAmount,
            from: account,
          })
            .should.be.fulfilled;
        }

        await crowdsale.finalize()
          .should.be.fulfilled;
        await crowdsale.send(ether(1))
          .should.be.rejectedWith(EVMThrow);
        await crowdsale
          .buyTokens({ value: ether(1), from: investor })
          .should.be.rejectedWith(EVMThrow);
      });

      // Pausable
      it("should be able to pause", async () => {
        const investmentAmount = ether(5000);

        await kyc.register(investor)
          .should.be.fulfilled;

        await crowdsale.pause()
          .should.be.fulfilled;

        await crowdsale.buyTokens({
          value: investmentAmount,
          from: investor,
        })
          .should.be.rejectedWith(EVMThrow);
      });

      it("should be able to finalize when paused", async () => {
        const numInvestor = 4;
        const eachInvestmentAmount = ether(5000);
        const totalInvestmentAmount = eachInvestmentAmount.mul(numInvestor);

        // 4 accounts, total 20,000 ether
        for (const account of accounts.slice(0, numInvestor)) {
          await kyc.register(account)
            .should.be.fulfilled;

          await crowdsale.buyTokens({
            value: eachInvestmentAmount,
            from: account,
          }).should.be.fulfilled;
        }

        const pauseTx = await crowdsale.pause()
          .should.be.fulfilled;

        console.log("pauseTx Gas Used :", pauseTx.receipt.gasUsed);
        await crowdsale.finalizeWhenForked()
          .should.be.fulfilled;

        // Ether Distribution
        const expectedDevBalance = new BigNumber(0);
        const expectedEachReserveBalance = new BigNumber(0);

        (await eth.getBalance(multiSig.address)).should.be.bignumber.equal(expectedDevBalance);
        reserveWallet.forEach(async (wallet) => {
          (await eth.getBalance(wallet)).should.be.bignumber.equal(expectedEachReserveBalance);
        });

        // refund claim
        for (const account of accounts.slice(0, numInvestor)) {
          const balanceBeforeRefund = await eth.getBalance(account);
          await crowdsale.claimRefund(account, { from: account })
            .should.be.fulfilled;
          const balanceAfterRefund = await eth.getBalance(account);

          (balanceAfterRefund - balanceBeforeRefund).should.be.within(
            ether(4999).toNumber(),
            ether(5000).toNumber(),
          );
        }
      });

      // // endTime1
      // it("can be finalized after endTime", async () => {
      //   const numInvestor = 8;
      //   const eachInvestmentAmount = ether(5000);
      //   const totalInvestmentAmount = eachInvestmentAmount.mul(numInvestor);
      //
      //   // 8 accounts, total 40,000 ether
      //   for (const account of accounts.slice(0, numInvestor)) {
      //     await kyc.register(account)
      //       .should.be.fulfilled;
      //
      //     await crowdsale.buyTokens({
      //       value: eachInvestmentAmount,
      //       from: account,
      //     })
      //       .should.be.fulfilled;
      //   }
      //
      //   await increaseTimeTo(afterEndTime);
      //
      //   await crowdsale.finalize()
      //     .should.be.fulfilled;
      //
      //   // Ether Distribution
      //   const expectedDevBalance = totalInvestmentAmount.div(10);
      //   const expectedEachReserveBalance = totalInvestmentAmount.mul(18).div(100);
      //
      //   (await eth.getBalance(multiSig.address))
      //     .should.be.bignumber.equal(expectedDevBalance);
      //
      //   reserveWallet.forEach(async (wallet) => {
      //     (await eth.getBalance(wallet))
      //       .should.be.bignumber.equal(expectedEachReserveBalance);
      //   });
      //
      //   // Token Distribution
      //   const totalSupply = await token.totalSupply();
      //   const expectedDevTokenBalance = totalSupply.mul(20).div(100).toNumber();
      //   const expectedEachReserveTokenBalance = totalSupply.mul(2).div(100).toNumber();
      //
      //   (await token.balanceOf(multiSig.address)).toNumber()
      //     .should.be.within(expectedDevTokenBalance - 10 * 10 ** 17, expectedDevTokenBalance + 10 * 10 ** 17);
      //
      //   for (let i = 0; i < 5; i++) {
      //     (await token.balanceOf(reserveWallet[ i ])).toNumber()
      //       .should.be.within(expectedEachReserveTokenBalance - 10 * 10 ** 17, expectedEachReserveTokenBalance + 10 * 10 ** 17);
      //   }
      // });

      // // endTime 2
      // it("can be finalized after endTime (when minEtherCap is not reached)", async () => {
      //   const numInvestor = 4;
      //   const eachInvestmentAmount = ether(5000);
      //   const totalInvestmentAmount = eachInvestmentAmount.mul(numInvestor);
      //
      //   // 8 accounts, total 40,000 ether
      //   for (const account of accounts.slice(0, numInvestor)) {
      //     await kyc.register(account)
      //       .should.be.fulfilled;
      //
      //     await crowdsale.buyTokens({
      //       value: eachInvestmentAmount,
      //       from: account,
      //     }).should.be.fulfilled;
      //   }
      //
      //   await increaseTimeTo(afterEndTime);
      //
      //   await crowdsale.finalize().should.be.fulfilled;
      //
      //   // Ether Distribution
      //   const expectedDevBalance = new BigNumber(0);
      //   const expectedEachReserveBalance = new BigNumber(0);
      //
      //   (await eth.getBalance(multiSig.address)).should.be.bignumber.equal(expectedDevBalance);
      //   reserveWallet.forEach(async (wallet) => {
      //     (await eth.getBalance(wallet)).should.be.bignumber.equal(expectedEachReserveBalance);
      //   });
      //   // refund claim
      //   for (const account of accounts.slice(0, numInvestor)) {
      //     const balanceBeforeRefund = await eth.getBalance(account);
      //     await crowdsale.claimRefund(account, { from: account }).should.be.fulfilled;
      //     const balanceAfterRefund = await eth.getBalance(account);
      //
      //     (balanceAfterRefund - balanceBeforeRefund).should.be.within(
      //       ether(4999).toNumber(),
      //       ether(5000).toNumber(),
      //     );
      //   }
      // });

      // endTime 3
      it("can be finalized after endTime (when minEtherCap is not reached) and refund by refundAll", async () => {
        const numInvestor = 20;
        const eachInvestmentAmount = ether(5);
        const totalInvestmentAmount = eachInvestmentAmount.mul(numInvestor);

        // 8 accounts, total 40,000 ether
        for (const account of accounts.slice(0, numInvestor)) {
          await kyc.register(account)
            .should.be.fulfilled;

          await crowdsale.buyTokens({
            value: eachInvestmentAmount,
            from: account,
          }).should.be.fulfilled;
        }

        await increaseTimeTo(afterEndTime);

        await crowdsale.finalize()
          .should.be.fulfilled;

        // Ether Distribution
        const expectedDevBalance = new BigNumber(0);
        const expectedEachReserveBalance = new BigNumber(0);

        (await eth.getBalance(multiSig.address)).should.be.bignumber.equal(expectedDevBalance);
        reserveWallet.forEach(async (wallet) => {
          (await eth.getBalance(wallet)).should.be.bignumber.equal(expectedEachReserveBalance);
        });

        const balanceBeforeRefund = [];
        const balanceAfterRefund = [];

        // store balanceBeforeRefund
        for (let i = 0; i < numInvestor; i++) {
          balanceBeforeRefund[ i ] = await eth.getBalance(accounts[ i ]);
        }
        // refund claim
        crowdsale.refundAll(numInvestor - 11, { from: owner })
          .should.be.fulfilled;

        // some investor claim refund
        const claimRefundTx = await crowdsale.claimRefund(accounts[ 13 ], { from: owner })
          .should.be.fulfilled;

        console.log("claimRefund Gas Used :", claimRefundTx.receipt.gasUsed);
        await crowdsale.refundAll(12, { from: owner })
          .should.be.fulfilled;

        // check refund
        for (let i = 0; i < numInvestor; i++) {
          balanceAfterRefund[ i ] = await eth.getBalance(accounts[ i ]);

          balanceAfterRefund[ i ].sub(balanceBeforeRefund[ i ])
            .should.be.bignumber.equal(eachInvestmentAmount);
        }
      });

      // afterEndTime
      it("should reject payments after end", async () => {
        await crowdsale.send(ether(1))
          .should.be.rejectedWith(EVMThrow);

        await kyc.register(investor)
          .should.be.fulfilled;

        await crowdsale.buyTokens({ value: ether(1), from: investor })
          .should.be.rejectedWith(EVMThrow);
      });

      it("should be able to change Token Owner", async () => {
        await token.pause()
          .should.be.rejectedWith(EVMThrow);

        // change token owner
        const changeTokenOwnerTx = await crowdsale.changeTokenOwner()
          .should.be.fulfilled;

        console.log("changeTokenOwner Gas Used :", changeTokenOwnerTx.receipt.gasUsed);

        (await token.owner())
          .should.be.equal(newTokenOwner);
      });
    });
  },
);
