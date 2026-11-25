---
title: homelab
order: 1
status: shipped
blurb: proxmox home server with a monitoring stack
---
## monitoring

A docker container on the server runs three tools:

- prometheus: collects metrics from the server
- grafana: turns those metrics into dashboards
- uptime kuma: checks whether my services are up

I set these up with ai help. I'm learning what the metrics mean by building my own dashboard panels.