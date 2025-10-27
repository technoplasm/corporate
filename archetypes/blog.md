---
title: "{{ replace .File.ContentBaseName "-" " " | title }}"
date: {{ .Date }}
author: "遠田"
slug: "{{ .File.ContentBaseName }}"
draft: true
---
