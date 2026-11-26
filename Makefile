.PHONY: check
check:
	bash scripts/check_version_bump.sh
	claude plugin validate . && claude plugin test .
