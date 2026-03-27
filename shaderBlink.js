var BLINK_TEXTURE_WIDTH = 480;

function createShaderBlinkLayer(mapInstance) {
  var selectedLights = [];
  var needsBufferUpdate = false;
  var active = false;

  var layer = {
    id: 'shader-blink-lights',
    type: 'custom',
    renderingMode: '2d',

    onAdd: function (map, gl) {
      var vertexSource = '#version 300 es\n' +
        'uniform mat4 u_matrix;\n' +
        'in vec2 a_pos;\n' +
        'in vec3 a_color;\n' +
        'in float a_lightIndex;\n' +
        'out vec3 v_color;\n' +
        'out float v_lightIndex;\n' +
        'void main() {\n' +
        '  gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);\n' +
        '  gl_PointSize = 12.0;\n' +
        '  v_color = a_color;\n' +
        '  v_lightIndex = a_lightIndex;\n' +
        '}\n';

      var fragmentSource = '#version 300 es\n' +
        'precision highp float;\n' +
        'uniform float u_time;\n' +
        'uniform sampler2D u_blinkPattern;\n' +
        'uniform float u_lightCount;\n' +
        'in vec3 v_color;\n' +
        'in float v_lightIndex;\n' +
        'out vec4 fragColor;\n' +
        'void main() {\n' +
        '  vec2 center = gl_PointCoord - vec2(0.5);\n' +
        '  float dist = length(center);\n' +
        '  if (dist > 0.5) discard;\n' +
        '  float minuteMs = u_time;\n' +
        '  float texY = (v_lightIndex + 0.5) / u_lightCount;\n' +
        '  float slot60 = floor(minuteMs / 1000.0);\n' +
        '  float slot120 = floor(minuteMs / 500.0);\n' +
        '  float slot240 = floor(minuteMs / 250.0);\n' +
        '  float slot480 = floor(minuteMs / 125.0);\n' +
        '  float texR = texture(u_blinkPattern, vec2((slot60 + 0.5) / ' + BLINK_TEXTURE_WIDTH + '.0, texY)).r;\n' +
        '  float texG = texture(u_blinkPattern, vec2((slot120 + 0.5) / ' + BLINK_TEXTURE_WIDTH + '.0, texY)).g;\n' +
        '  float texB = texture(u_blinkPattern, vec2((slot240 + 0.5) / ' + BLINK_TEXTURE_WIDTH + '.0, texY)).b;\n' +
        '  float texA = texture(u_blinkPattern, vec2((slot480 + 0.5) / ' + BLINK_TEXTURE_WIDTH + '.0, texY)).a;\n' +
        '  float isOn = max(max(texR, texG), max(texB, texA));\n' +
        '  if (isOn < 0.5) discard;\n' +
        '  float edge = smoothstep(0.5, 0.4, dist);\n' +
        '  fragColor = vec4(v_color * edge, edge);\n' +
        '}\n';

      var vertexShader = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(vertexShader, vertexSource);
      gl.compileShader(vertexShader);
      if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
        console.error('Vertex shader error:', gl.getShaderInfoLog(vertexShader));
      }

      var fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fragmentShader, fragmentSource);
      gl.compileShader(fragmentShader);
      if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
        console.error('Fragment shader error:', gl.getShaderInfoLog(fragmentShader));
      }

      this.program = gl.createProgram();
      gl.attachShader(this.program, vertexShader);
      gl.attachShader(this.program, fragmentShader);
      gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
        console.error('Program link error:', gl.getProgramInfoLog(this.program));
      }

      this.aPos = gl.getAttribLocation(this.program, 'a_pos');
      this.aColor = gl.getAttribLocation(this.program, 'a_color');
      this.aLightIndex = gl.getAttribLocation(this.program, 'a_lightIndex');
      this.uMatrix = gl.getUniformLocation(this.program, 'u_matrix');
      this.uTime = gl.getUniformLocation(this.program, 'u_time');
      this.uBlinkPattern = gl.getUniformLocation(this.program, 'u_blinkPattern');
      this.uLightCount = gl.getUniformLocation(this.program, 'u_lightCount');

      this.vertexBuffer = gl.createBuffer();
      this.blinkTexture = gl.createTexture();
      this.vertexCount = 0;
      this.lightCount = 0;

      this.map = map;
      this.gl = gl;
    },

    render: function (gl, args) {
      if (!active) return;

      if (needsBufferUpdate) {
        this._updateBuffers();
        needsBufferUpdate = false;
      }

      if (this.vertexCount === 0) return;

      gl.useProgram(this.program);

      var matrix = args.defaultProjectionData.mainMatrix;
      gl.uniformMatrix4fv(this.uMatrix, false, matrix);

      var now = Date.now();
      gl.uniform1f(this.uTime, now % 60000);
      gl.uniform1f(this.uLightCount, this.lightCount);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.blinkTexture);
      gl.uniform1i(this.uBlinkPattern, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);

      var stride = 6 * 4;
      gl.enableVertexAttribArray(this.aPos);
      gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, stride, 0);

      gl.enableVertexAttribArray(this.aColor);
      gl.vertexAttribPointer(this.aColor, 3, gl.FLOAT, false, stride, 2 * 4);

      gl.enableVertexAttribArray(this.aLightIndex);
      gl.vertexAttribPointer(this.aLightIndex, 1, gl.FLOAT, false, stride, 5 * 4);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      gl.drawArrays(gl.POINTS, 0, this.vertexCount);

      gl.disableVertexAttribArray(this.aPos);
      gl.disableVertexAttribArray(this.aColor);
      gl.disableVertexAttribArray(this.aLightIndex);

      this.map.triggerRepaint();
    },

    _updateBuffers: function () {
      var gl = this.gl;
      if (!gl || selectedLights.length === 0) {
        this.vertexCount = 0;
        this.lightCount = 0;
        return;
      }

      this.lightCount = selectedLights.length;
      var vertices = new Float32Array(selectedLights.length * 6);

      var textureData = new Uint8Array(BLINK_TEXTURE_WIDTH * 4 * selectedLights.length);

      for (var i = 0; i < selectedLights.length; i++) {
        var light = selectedLights[i];
        var mc = maplibregl.MercatorCoordinate.fromLngLat(light.lngLat);
        var offset = i * 6;
        vertices[offset] = mc.x;
        vertices[offset + 1] = mc.y;
        vertices[offset + 2] = light.color[0];
        vertices[offset + 3] = light.color[1];
        vertices[offset + 4] = light.color[2];
        vertices[offset + 5] = i;

        var lightOnN = light.lightOnN || 60;
        var rowOffset = i * BLINK_TEXTURE_WIDTH * 4;

        for (var s = 0; s < BLINK_TEXTURE_WIDTH; s++) {
          var pixelOffset = rowOffset + s * 4;
          textureData[pixelOffset] = 0;
          textureData[pixelOffset + 1] = 0;
          textureData[pixelOffset + 2] = 0;
          textureData[pixelOffset + 3] = 0;

          if (lightOnN === 60 && s < 60) {
            textureData[pixelOffset] = light.blinkSlots[s] ? 255 : 0;
          }
          if (lightOnN === 120 && s < 120) {
            textureData[pixelOffset + 1] = light.blinkSlots[s] ? 255 : 0;
          }
          if (lightOnN === 240 && s < 240) {
            textureData[pixelOffset + 2] = light.blinkSlots[s] ? 255 : 0;
          }
          if (lightOnN === 480) {
            textureData[pixelOffset + 3] = light.blinkSlots[s] ? 255 : 0;
          }
        }
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
      this.vertexCount = selectedLights.length;

      var texHeight = Math.max(selectedLights.length, 1);
      gl.bindTexture(gl.TEXTURE_2D, this.blinkTexture);
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA,
        BLINK_TEXTURE_WIDTH, texHeight, 0,
        gl.RGBA, gl.UNSIGNED_BYTE, textureData
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
  };

  function parseHexColor(hex) {
    if (!hex || hex.length < 7) return [1.0, 1.0, 0.0];
    var r = parseInt(hex.substring(1, 3), 16) / 255.0;
    var g = parseInt(hex.substring(3, 5), 16) / 255.0;
    var b = parseInt(hex.substring(5, 7), 16) / 255.0;
    return [r, g, b];
  }

  function getFeatureCenter(f) {
    if (f.geometry.type === 'Point') {
      return { lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
    }
    var centroid = turf.centroid(f);
    return { lng: centroid.geometry.coordinates[0], lat: centroid.geometry.coordinates[1] };
  }

  function setSelectedFeatures(features) {
    selectedLights = [];
    var seen = {};
    for (var i = 0; i < features.length; i++) {
      var f = features[i];
      var props = f.properties;
      var ufid = props.ufid;
      if (ufid && seen[ufid]) continue;
      if (ufid) seen[ufid] = true;

      var lightOnN = props['LIGHT_ON_N'] || 60;
      var blinkSlots = [];
      var onCount = 0;
      for (var s = 0; s < lightOnN; s++) {
        var isOn = !!props['LIGHT_ON_' + s];
        blinkSlots.push(isOn);
        if (isOn) onCount++;
      }

      var center = getFeatureCenter(f);

      selectedLights.push({
        lngLat: center,
        color: parseHexColor(props['COLOUR_HEX']),
        lightOnN: lightOnN,
        blinkSlots: blinkSlots
      });
    }
    needsBufferUpdate = true;
    if (selectedLights.length > 0) {
      active = true;
      mapInstance.triggerRepaint();
    }
  }

  function setActive(isActive) {
    active = isActive;
    if (active && selectedLights.length > 0) {
      mapInstance.triggerRepaint();
    }
  }

  function clearSelection() {
    selectedLights = [];
    active = false;
    needsBufferUpdate = true;
  }

  return {
    layer: layer,
    setSelectedFeatures: setSelectedFeatures,
    setActive: setActive,
    clearSelection: clearSelection
  };
}
