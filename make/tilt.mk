.PHONY: tilt-up tilt-down

## tilt-up — Start Tilt dev stack (blocks until API + Vite healthy)
tilt-up:
	$(call STEP,tilt:up)
	bash scripts/tilt/up-dev.sh
	$(call OK,Tilt dev stack ready)

## tilt-down — Stop Tilt dev stack
tilt-down:
	$(call STEP,tilt:down)
	bash scripts/tilt/down-dev.sh
	$(call OK,Tilt stopped)
