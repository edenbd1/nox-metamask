import { ethers, network } from 'hardhat';

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Network: ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(
    `Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`,
  );

  const TestERC20 = await ethers.getContractFactory('TestERC20');
  const usdc = await TestERC20.deploy(
    'Mock USDC',
    'mUSDC',
    6,
    1_000_000n * 10n ** 6n,
  );
  await usdc.waitForDeployment();
  const usdcAddr = await usdc.getAddress();
  console.log(`TestERC20 (mUSDC) deployed at: ${usdcAddr}`);

  const Wrapper = await ethers.getContractFactory('ConfidentialWrappedUSDC');
  const wrapper = await Wrapper.deploy(usdcAddr);
  await wrapper.waitForDeployment();
  const wrapperAddr = await wrapper.getAddress();
  console.log(`ConfidentialWrappedUSDC (cUSDC) deployed at: ${wrapperAddr}`);

  console.log('\nAddresses:');
  console.log(JSON.stringify({ mUSDC: usdcAddr, cUSDC: wrapperAddr }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
