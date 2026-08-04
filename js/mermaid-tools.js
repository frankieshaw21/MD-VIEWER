(function(global) {
  'use strict';
  const namespace = global.MDViewer || (global.MDViewer = {});

  function create(options) {
    options = options || {};
    const context = options.context;
    if (!context || typeof context.getPort !== 'function') throw new TypeError('MermaidTools requires context');

    const MIN_SCALE = 0.1;
    const MAX_SCALE = 5;
    const MAX_PNG_EDGE = 8192;
    const MAX_PNG_PIXELS = 32 * 1024 * 1024;
    let started = false;
    let editor = null;
    let editorEl = null;
    let toolbar = null;
    let activeContainer = null;
    let layoutFrame = null;
    let resizeObserver = null;
    let fullscreenState = null;

    function clampScale(value) {
      const number = Number(value);
      return Math.max(MIN_SCALE, Math.min(MAX_SCALE, Number.isFinite(number) ? number : 1));
    }

    function roundScale(value) {
      return Math.round(clampScale(value) * 1000) / 1000;
    }

    function naturalSize(svg) {
      if (!svg) return null;
      const box = svg.viewBox && svg.viewBox.baseVal;
      if (box && Number.isFinite(box.width) && box.width > 0 && Number.isFinite(box.height) && box.height > 0) {
        return { width: box.width, height: box.height };
      }
      const values = String(svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
      if (values.length === 4 && values.every(Number.isFinite) && values[2] > 0 && values[3] > 0) {
        return { width: values[2], height: values[3] };
      }
      return null;
    }
    function targetFor(value) {
      if (!value) return null;
      if (value.matches && value.matches('.mermaid')) return value;
      if (value.matches && value.matches('.mermaid-container')) return value.querySelector(':scope > .mermaid');
      if (value.matches && value.matches('svg')) return value.closest('.mermaid');
      return null;
    }

    function containerFor(value) {
      const target = targetFor(value);
      return target && target.closest ? target.closest('.mermaid-container') : null;
    }

    function currentTarget() {
      return containerFor(activeContainer) ? targetFor(activeContainer) : null;
    }

    function getScale(target) {
      return roundScale(target && target.dataset.mermaidScale || 1);
    }

    function notifyScrollbar(target) {
      const container = containerFor(target);
      if (container && editor && typeof editor.updateMermaidStickyScrollbar === 'function') {
        global.requestAnimationFrame(function() {
          if (container.isConnected) editor.updateMermaidStickyScrollbar(container);
        });
      }
    }

    function applyScale(target, value) {
      const svg = target && target.querySelector ? target.querySelector(':scope > svg, svg') : null;
      const size = naturalSize(svg);
      if (!target || !svg || !size) return false;
      const scale = roundScale(value);
      target.dataset.mermaidScale = String(scale);
      const width = Math.round(size.width * scale * 100) / 100 + 'px';
      if (svg.style.width !== width) svg.style.width = width;
      svg.style.height = 'auto';
      svg.style.maxWidth = 'none';
      svg.style.display = 'block';
      svg.style.margin = '0 auto';
      updateScaleLabel(scale);
      notifyScrollbar(target);
      scheduleToolbarLayout();
      return scale;
    }

    function fitTarget(target) {
      const svg = target && target.querySelector ? target.querySelector(':scope > svg, svg') : null;
      const size = naturalSize(svg);
      if (!target || !size) return false;
      const available = Math.max(1, target.clientWidth);
      return applyScale(target, available / size.width);
    }

    function makeButton(action, label, title) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mermaid-tools-button mermaid-tools-button-' + action;
      button.dataset.mermaidAction = action;
      button.textContent = label;
      button.title = title;
      button.setAttribute('aria-label', title);
      return button;
    }

    function appendToolButtons(parent, fullscreen) {
      parent.appendChild(makeButton('zoom-out', '−', '缩小 Mermaid 图'));
      parent.appendChild(makeButton('zoom-in', '+', '放大 Mermaid 图'));
      parent.appendChild(makeButton('reset', '1:1', '重置为 1:1'));
      parent.appendChild(makeButton('fit', '适应', '适应可用宽度'));
      if (!fullscreen) parent.appendChild(makeButton('fullscreen', '全屏', '全屏查看'));
      parent.appendChild(makeButton('export-svg', 'SVG', '导出 SVG'));
      parent.appendChild(makeButton('export-png', 'PNG', '导出 PNG'));
      if (fullscreen) parent.appendChild(makeButton('close', '×', '关闭全屏'));
    }

    function createToolbar() {
      const element = document.createElement('div');
      element.className = 'mermaid-tools';
      element.contentEditable = 'false';
      element.hidden = true;
      element.style.position = 'fixed';
      element.style.zIndex = '9999';
      element.setAttribute('role', 'toolbar');
      element.setAttribute('aria-label', 'Mermaid 图工具');
      appendToolButtons(element, false);
      const label = document.createElement('span');
      label.className = 'mermaid-tools-scale';
      label.setAttribute('aria-live', 'polite');
      element.appendChild(label);
      document.body.appendChild(element);
      return element;
    }

    function updateScaleLabel(scale) {
      if (!toolbar) return;
      const label = toolbar.querySelector('.mermaid-tools-scale');
      if (label) label.textContent = Math.round(clampScale(scale) * 100) + '%';
    }
    function positionToolbar() {
      layoutFrame = null;
      if (!toolbar || toolbar.hidden || !activeContainer || !activeContainer.isConnected) return;
      const rect = activeContainer.getBoundingClientRect();
      const gap = 8;
      const width = toolbar.offsetWidth;
      const height = toolbar.offsetHeight;
      const left = Math.max(gap, Math.min(global.innerWidth - width - gap, rect.right - width));
      const above = rect.top - height - gap;
      const top = above >= gap ? above : Math.min(global.innerHeight - height - gap, rect.top + gap);
      toolbar.style.left = Math.round(left) + 'px';
      toolbar.style.top = Math.round(Math.max(gap, top)) + 'px';
    }

    function scheduleToolbarLayout() {
      if (layoutFrame !== null) return;
      layoutFrame = global.requestAnimationFrame(positionToolbar);
    }

    function deactivate() {
      if (activeContainer) activeContainer.classList.remove('mermaid-container-active');
      activeContainer = null;
      if (toolbar) {
        toolbar.hidden = true;
        toolbar.classList.remove('active');
      }
    }

    function activate(container) {
      const target = targetFor(container);
      const nextContainer = containerFor(target);
      if (!target || !nextContainer || !target.querySelector('svg')) return false;
      if (activeContainer && activeContainer !== nextContainer) {
        activeContainer.classList.remove('mermaid-container-active');
      }
      activeContainer = nextContainer;
      activeContainer.classList.add('mermaid-container-active');
      toolbar.hidden = false;
      toolbar.classList.add('active');
      applyScale(target, getScale(target));
      updateScaleLabel(getScale(target));
      scheduleToolbarLayout();
      return true;
    }

    function refreshTarget(target) {
      const svg = target && target.querySelector ? target.querySelector('svg') : null;
      if (!svg) return false;
      return applyScale(target, getScale(target));
    }

    function refreshAll() {
      if (!editorEl) return;
      editorEl.querySelectorAll('.mermaid-container > .mermaid').forEach(refreshTarget);
      if (activeContainer && !activeContainer.isConnected) deactivate();
      scheduleToolbarLayout();
    }

    function scheduleRefresh() {
      global.requestAnimationFrame(refreshAll);
    }

    function reportFailure(error) {
      const failure = error instanceof Error ? error : new Error(String(error || 'Mermaid operation failed'));
      if (global.console && typeof global.console.error === 'function') {
        global.console.error('Mermaid tools operation failed.', failure);
      }
      try { context.emit('mermaid-tools:error', { error: failure }); } catch (emitError) {}
      return false;
    }

    function onDocumentPointerDown(event) {
      if (fullscreenState && fullscreenState.overlay.contains(event.target)) return;
      if (toolbar && toolbar.contains(event.target)) return;
      const container = event.target && event.target.closest ? event.target.closest('#editor .mermaid-container') : null;
      if (container && editorEl.contains(container)) activate(container);
      else deactivate();
    }

    function runAction(action, target, fullscreen) {
      if (!target) return false;
      if (action === 'zoom-out') return fullscreen ? zoomFullscreen(0.8) : applyScale(target, getScale(target) * 0.8);
      if (action === 'zoom-in') return fullscreen ? zoomFullscreen(1.25) : applyScale(target, getScale(target) * 1.25);
      if (action === 'reset') return fullscreen ? resetFullscreen() : applyScale(target, 1);
      if (action === 'fit') return fullscreen ? fitFullscreen() : fitTarget(target);
      if (action === 'fullscreen') return openFullscreen(target);
      if (action === 'export-svg') return exportSvg(target.querySelector('svg'));
      if (action === 'export-png') return exportPng(target.querySelector('svg'));
      if (action === 'close') return closeFullscreen();
      return false;
    }

    function onToolbarClick(event) {
      const button = event.target.closest('[data-mermaid-action]');
      if (!button || !toolbar.contains(button)) return;
      event.preventDefault();
      try {
        Promise.resolve(runAction(button.dataset.mermaidAction, currentTarget(), false)).catch(reportFailure);
      } catch (error) { reportFailure(error); }
    }
    function exportClone(svg, width, height) {
      if (!svg) throw new Error('No Mermaid SVG is available');
      const clone = svg.cloneNode(true);
      if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      if (!clone.getAttribute('xmlns:xlink')) clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
      if (width && height) {
        clone.setAttribute('width', String(width));
        clone.setAttribute('height', String(height));
        clone.style.width = width + 'px';
        clone.style.height = height + 'px';
      }
      return clone;
    }

    function serializeSvg(svg, width, height) {
      const clone = exportClone(svg, width, height);
      return '<?xml version="1.0" encoding="UTF-8"?>\n' + new global.XMLSerializer().serializeToString(clone);
    }

    function filename(extension) {
      return 'mermaid-diagram.' + extension;
    }

    function downloadBlob(blob, name) {
      const url = global.URL.createObjectURL(blob);
      let clicked = false;
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.hidden = true;
        document.body.appendChild(link);
        link.click();
        clicked = true;
        link.remove();
      } finally {
        global.setTimeout(function() { global.URL.revokeObjectURL(url); }, clicked ? 1000 : 0);
      }
      return true;
    }

    function exportSvg(svg) {
      try {
        const xml = serializeSvg(svg);
        return downloadBlob(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }), filename('svg'));
      } catch (error) {
        reportFailure(error);
        return false;
      }
    }

    function pngDimensions(svg) {
      const size = naturalSize(svg);
      if (!size) throw new Error('Mermaid SVG has no valid viewBox');
      const factor = Math.min(
        1,
        MAX_PNG_EDGE / size.width,
        MAX_PNG_EDGE / size.height,
        Math.sqrt(MAX_PNG_PIXELS / (size.width * size.height))
      );
      return {
        width: Math.max(1, Math.min(MAX_PNG_EDGE, Math.floor(size.width * factor))),
        height: Math.max(1, Math.min(MAX_PNG_EDGE, Math.floor(size.height * factor)))
      };
    }

    function exportPng(svg) {
      return new Promise(function(resolve, reject) {
        let sourceUrl = null;
        try {
          const dimensions = pngDimensions(svg);
          const xml = serializeSvg(svg, dimensions.width, dimensions.height);
          sourceUrl = global.URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
          const image = new global.Image();
          image.onload = function() {
            global.URL.revokeObjectURL(sourceUrl);
            sourceUrl = null;
            try {
              const canvas = document.createElement('canvas');
              canvas.width = dimensions.width;
              canvas.height = dimensions.height;
              const drawing = canvas.getContext('2d');
              if (!drawing) throw new Error('Canvas 2D is unavailable');
              drawing.drawImage(image, 0, 0, dimensions.width, dimensions.height);
              canvas.toBlob(function(blob) {
                if (!blob) {
                  reject(new Error('PNG encoding returned no data'));
                  return;
                }
                try { resolve(downloadBlob(blob, filename('png'))); }
                catch (error) { reject(error); }
              }, 'image/png');
            } catch (error) { reject(error); }
          };
          image.onerror = function() {
            if (sourceUrl) global.URL.revokeObjectURL(sourceUrl);
            sourceUrl = null;
            reject(new Error('Unable to decode Mermaid SVG for PNG export'));
          };
          image.src = sourceUrl;
        } catch (error) {
          if (sourceUrl) global.URL.revokeObjectURL(sourceUrl);
          reject(error);
        }
      });
    }
    function updateFullscreenLabel() {
      if (!fullscreenState) return;
      const label = fullscreenState.toolbar.querySelector('.mermaid-fullscreen-scale');
      if (label) label.textContent = Math.round(fullscreenState.scale * 100) + '%';
    }

    function applyFullscreenTransform() {
      if (!fullscreenState) return false;
      const state = fullscreenState;
      state.scale = roundScale(state.scale);
      const width = Math.round(state.size.width * state.scale * 100) / 100;
      const height = Math.round(state.size.height * state.scale * 100) / 100;
      state.svg.style.width = width + 'px';
      state.svg.style.height = height + 'px';
      state.svg.style.maxWidth = 'none';
      state.svg.style.display = 'block';
      state.canvas.style.width = width + 'px';
      state.canvas.style.height = height + 'px';
      state.canvas.style.transform = 'translate(' + Math.round(state.panX) + 'px,' + Math.round(state.panY) + 'px)';
      updateFullscreenLabel();
      return state.scale;
    }

    function centerFullscreen() {
      if (!fullscreenState) return false;
      const state = fullscreenState;
      state.panX = (state.stage.clientWidth - state.size.width * state.scale) / 2;
      state.panY = (state.stage.clientHeight - state.size.height * state.scale) / 2;
      return applyFullscreenTransform();
    }

    function zoomFullscreen(factor) {
      if (!fullscreenState) return false;
      const state = fullscreenState;
      const previous = state.scale;
      const next = roundScale(previous * factor);
      const centerX = state.stage.clientWidth / 2;
      const centerY = state.stage.clientHeight / 2;
      const imageX = (centerX - state.panX) / previous;
      const imageY = (centerY - state.panY) / previous;
      state.scale = next;
      state.panX = centerX - imageX * next;
      state.panY = centerY - imageY * next;
      return applyFullscreenTransform();
    }

    function resetFullscreen() {
      if (!fullscreenState) return false;
      fullscreenState.scale = 1;
      return centerFullscreen();
    }

    function fitFullscreen() {
      if (!fullscreenState) return false;
      const state = fullscreenState;
      const availableWidth = Math.max(1, state.stage.clientWidth - 32);
      const availableHeight = Math.max(1, state.stage.clientHeight - 32);
      state.scale = roundScale(Math.min(availableWidth / state.size.width, availableHeight / state.size.height));
      return centerFullscreen();
    }

    function bindFullscreenDrag(state) {
      let dragging = false;
      let pointerId = null;
      let startX = 0;
      let startY = 0;
      let startPanX = 0;
      let startPanY = 0;

      function finish(event) {
        if (!dragging || (event && pointerId !== null && event.pointerId !== pointerId)) return;
        dragging = false;
        state.stage.classList.remove('mermaid-fullscreen-panning');
        if (pointerId !== null && state.stage.hasPointerCapture && state.stage.hasPointerCapture(pointerId)) {
          try { state.stage.releasePointerCapture(pointerId); } catch (error) {}
        }
        pointerId = null;
      }

      state.stage.addEventListener('pointerdown', function(event) {
        if (event.button !== 0 || event.isPrimary === false) return;
        dragging = true;
        pointerId = event.pointerId;
        startX = event.clientX;
        startY = event.clientY;
        startPanX = state.panX;
        startPanY = state.panY;
        state.stage.classList.add('mermaid-fullscreen-panning');
        try { state.stage.setPointerCapture(pointerId); } catch (error) {}
        event.preventDefault();
      });
      state.stage.addEventListener('pointermove', function(event) {
        if (!dragging || event.pointerId !== pointerId) return;
        state.panX = startPanX + event.clientX - startX;
        state.panY = startPanY + event.clientY - startY;
        applyFullscreenTransform();
        event.preventDefault();
      });
      state.stage.addEventListener('pointerup', finish);
      state.stage.addEventListener('pointercancel', finish);
      state.stage.addEventListener('lostpointercapture', finish);
      state.stage.addEventListener('dragstart', function(event) { event.preventDefault(); });
    }
    function openFullscreen(value) {
      const target = targetFor(value) || currentTarget();
      const sourceSvg = target && target.querySelector ? target.querySelector('svg') : null;
      const size = naturalSize(sourceSvg);
      if (!sourceSvg || !size) return false;
      closeFullscreen();

      const overlay = document.createElement('div');
      overlay.className = 'mermaid-fullscreen-overlay';
      overlay.contentEditable = 'false';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', 'Mermaid 全屏查看');
      overlay.style.position = 'fixed';
      overlay.style.inset = '0';
      overlay.style.zIndex = '10000';
      overlay.style.display = 'flex';
      overlay.style.flexDirection = 'column';

      const fullToolbar = document.createElement('div');
      fullToolbar.className = 'mermaid-fullscreen-toolbar';
      fullToolbar.setAttribute('role', 'toolbar');
      fullToolbar.setAttribute('aria-label', 'Mermaid 全屏工具');
      appendToolButtons(fullToolbar, true);
      const scaleLabel = document.createElement('span');
      scaleLabel.className = 'mermaid-fullscreen-scale';
      scaleLabel.setAttribute('aria-live', 'polite');
      fullToolbar.appendChild(scaleLabel);

      const stage = document.createElement('div');
      stage.className = 'mermaid-fullscreen-stage';
      stage.style.position = 'relative';
      stage.style.flex = '1 1 auto';
      stage.style.minHeight = '0';
      stage.style.overflow = 'hidden';
      stage.style.touchAction = 'none';
      const canvas = document.createElement('div');
      canvas.className = 'mermaid-fullscreen-canvas';
      canvas.style.position = 'absolute';
      canvas.style.left = '0';
      canvas.style.top = '0';
      canvas.style.transformOrigin = '0 0';
      const clone = sourceSvg.cloneNode(true);
      clone.classList.add('mermaid-fullscreen-svg');
      canvas.appendChild(clone);
      stage.appendChild(canvas);
      overlay.append(fullToolbar, stage);
      document.body.appendChild(overlay);
      document.body.classList.add('mermaid-fullscreen-open');

      fullscreenState = {
        overlay: overlay, toolbar: fullToolbar, stage: stage, canvas: canvas,
        svg: clone, size: size, scale: 1, panX: 0, panY: 0
      };
      bindFullscreenDrag(fullscreenState);
      fullToolbar.addEventListener('click', function(event) {
        const button = event.target.closest('[data-mermaid-action]');
        if (!button || !fullToolbar.contains(button) || !fullscreenState) return;
        event.preventDefault();
        try {
          Promise.resolve(runAction(button.dataset.mermaidAction, fullscreenState.canvas, true)).catch(reportFailure);
        } catch (error) { reportFailure(error); }
      });
      global.requestAnimationFrame(function() {
        if (fullscreenState && fullscreenState.overlay === overlay) fitFullscreen();
      });
      return true;
    }

    function closeFullscreen() {
      if (!fullscreenState) return false;
      const overlay = fullscreenState.overlay;
      fullscreenState = null;
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      document.body.classList.remove('mermaid-fullscreen-open');
      return true;
    }

    function isFullscreen() {
      return Boolean(fullscreenState && fullscreenState.overlay.isConnected);
    }

    function onWindowResize() {
      scheduleRefresh();
      if (fullscreenState) fitFullscreen();
    }

    function subscribe() {
      context.on('render:completed', scheduleRefresh);
      context.on('render:enhanced', scheduleRefresh);
      context.on('document:replaced', scheduleRefresh);
    }

    function start() {
      if (started) return api;
      editor = context.getPort('editor');
      editorEl = context.elements.editor;
      if (!editor || !editorEl) throw new Error('MermaidTools dependencies are incomplete');
      toolbar = createToolbar();
      started = true;
      subscribe();
      document.addEventListener('pointerdown', onDocumentPointerDown, true);
      toolbar.addEventListener('click', onToolbarClick);
      global.addEventListener('resize', onWindowResize);
      global.addEventListener('scroll', scheduleToolbarLayout, true);
      if (global.ResizeObserver) {
        resizeObserver = new global.ResizeObserver(scheduleRefresh);
        resizeObserver.observe(editorEl);
      }
      refreshAll();
      return api;
    }

    const api = Object.freeze({
      start: start,
      closeFullscreen: closeFullscreen,
      isFullscreen: isFullscreen,
      openFullscreen: openFullscreen
    });
    return api;
  }

  namespace.MermaidTools = Object.freeze({ create: create });
})(window);
