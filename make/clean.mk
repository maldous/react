.PHONY: clean clean-all

## clean — Stop app services for ENV, kill stale processes, remove artefacts
clean:
	$(call STEP,clean: $(ENV))
	bash scripts/clean/clean-env.sh $(ENV)
	bash scripts/clean/assert-clean.sh $(ENV)
	$(call OK,clean complete for $(ENV))

## clean-all — Stop dev and test environments (staging/prod are HA — manage manually)
clean-all:
	$(MAKE) clean ENV=dev
	$(MAKE) clean ENV=test
	$(call OK,all environments cleaned)
