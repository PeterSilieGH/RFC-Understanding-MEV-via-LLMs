from web3 import Web3
import requests

class Extractor:
    # Update this line to include llm_client=None
    def __init__(self, web3_instance, etherscan_key=None, llm_client=None):
        self.w3 = web3_instance
        self.api_key = etherscan_key
        self.llm_client = llm_client  # Save it to the class instance
        self.contract_cache = {}
        
    def get_contract_data(self, address):
        """Retrieves source code if verified, otherwise grabs bytecode."""
        if address in self.contract_cache:
            return self.contract_cache[address]

        # Step 1: Retrieval of verified metadata
        url = f"https://api.etherscan.io/api?module=contract&action=getsourcecode&address={address}&apikey={self.api_key}"
        try:
            res = requests.get(url).json()
            if res['status'] == '1' and res['result'][0]['SourceCode']:
                data = {
                    "verified": True,
                    "name": res['result'][0]['ContractName'],
                    "source": res['result'][0]['SourceCode'],
                    "abi": res['result'][0]['ABI']
                }
            else:
                # Step 2: Bytecode Decompilation (Fallback)
                checksum_addr = Web3.to_checksum_address(address)
                bytecode = self.w3.eth.get_code(checksum_addr).hex()
                data = {
                    "verified": False,
                    "name": "Unknown",
                    "bytecode": bytecode,
                    "note": "Needs Panoramix/eveem decompilation"
                }
            
            self.contract_cache[address] = data
            return data
            
        except Exception as e:
            return {"verified": False, "error": str(e)}