class Extractor:
    def __init__(self, llm_client, etherscan_api):
        self.llm_client = llm_client
        self.etherscan_api = etherscan_api

    def extract(self, data):
        raise NotImplementedError("Extractor must implement the extract method.")
    
    def get_code(self, address: str) -> str:
        source = self.api.get_source(address)
        if source:
            return source
        return self._decompile_and_refine(address)

    def _decompile_and_refine(self, address: str) -> str:
        raw_bytecode = self.api.get_bytecode(address)
        pseudocode = self._run_panoramix(raw_bytecode)
        return self.llm.generate(f"Refine this EVM pseudocode: {pseudocode}")
    
    def _run_panoramix(self, bytecode: str) -> str:
        pass