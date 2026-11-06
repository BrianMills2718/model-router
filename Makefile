.PHONY: check
check:
	claude plugin validate . && claude plugin test .
