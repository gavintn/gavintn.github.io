---
title: homelab
order: 1
status: shipped
blurb: proxmox home server with a monitoring stack
---
## overview

a single proxmox server at home that I use to learn virtualization, networking and self-hosting.

## what runs on it

- a home assistant vm, for smart-home experiments
- a pi-hole container, for network-wide dns and ad blocking
- a docker container, which runs the monitoring stack below

## access

I reach it remotely over tailscale, so nothing on it is exposed to the public internet.

## monitoring

A docker container on the server runs three tools:

- prometheus: collects metrics from the server
- grafana: turns those metrics into dashboards
- uptime kuma: checks whether my services are up

I set these up with ai help. I'm learning what the metrics mean by building my own dashboard panels.