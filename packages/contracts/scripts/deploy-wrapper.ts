import { ethers, network } from 'hardhat';

async function main() {
  const UNDERLYING = process.env.UNDERLYING;
  if (!UNDERLYING || !/^0x[0-9a-fA-F]{40}$/.test(UNDERLYING)) {
    throw new Error('UNDERLYING env var missing or invalid');
  }

  const [deployer] = await ethers.getSigners();
  console.log(`Network:    ${network.name}`);
  console.log(`Deployer:   ${deployer.address}`);
  console.log(`Underlying: ${UNDERLYING}`);
  console.log(
    `Balance:    ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`,
  );

  const Wrapper = await ethers.getContractFactory('ConfidentialWrappedUSDC');
  const wrapper = await Wrapper.deploy(UNDERLYING);
  await wrapper.waitForDeployment();
  const wrapperAddr = await wrapper.getAddress();

  console.log(`\nConfidentialWrappedUSDC deployed at: ${wrapperAddr}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
