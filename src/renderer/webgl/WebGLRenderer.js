/**
* @author       Richard Davey (@photonstorm)
* @author       Felipe Alfonso (@bitnenfer)
* @copyright    2017 Photon Storm Ltd.
* @license      {@link https://github.com/photonstorm/phaser/blob/master/license.txt|MIT License}
*/

var BlendModes = require('../BlendModes');
var BlitterBatch = require('./pipelines/blitterbatch/BlitterBatch');
var Class = require('../../utils/Class');
var CONST = require('../../const');
var EffectRenderer = require('./pipelines/effectrenderer/EffectRenderer');
var IsSizePowerOfTwo = require('../../math/pow2/IsSizePowerOfTwo');
var MaskRenderer = require('./pipelines/maskrenderer/MaskRenderer');
var QuadBatch = require('./pipelines/quadbatch/QuadBatch');
var ParticleRenderer = require('./pipelines/particlerenderer/ParticleRenderer');
var ResourceManager = require('./ResourceManager');
var Resources = require('./resources');
var ScaleModes = require('../ScaleModes');
var ShapeBatch = require('./pipelines/shapebatch/ShapeBatch');
var SpriteBatch = require('./pipelines/spritebatch/SpriteBatch');
var TileBatch = require('./pipelines/tilebatch/TileBatch');
var TilemapRenderer = require('./pipelines/tilemaprenderer/TilemapRenderer');
var WebGLSnapshot = require('../snapshot/WebGLSnapshot');

var WebGLpipeline = new Class({

    initialize:

    function WebGLpipeline (game)
    {
        var _this = this;
        this.game = game;
        this.onContextLostCallbacks = [];
        this.onContextRestoredCallbacks = [];
        this.type = CONST.WEBGL;
        this.width = game.config.width * game.config.resolution;
        this.height = game.config.height * game.config.resolution;
        this.resolution = game.config.resolution;
        this.view = game.canvas;
        this.view.addEventListener('webglcontextlost', function (evt) {
            var callbacks = _this.onContextLostCallbacks;
            var pipelines = _this.pipelines;
            for (var index = 0; index < pipelines.length; ++index)
            {
                pipelines[index].destroy();
            }
            _this.contextLost = true;
            for (var index = 0; index < callbacks.length; ++index)
            {
                callbacks[index](_this);
            }
            evt.preventDefault();
        }, false);

        this.view.addEventListener('webglcontextrestored', function (evt) {
            var callbacks = _this.onContextRestoredCallbacks;
            _this.pipelines.length = 0;
            _this.resourceManager.shaderCache = {};
            _this.resourceManager.shaderCount = 0;
            _this.contextLost = false;
            _this.init();
            _this.game.textures.each(function (texture) {
                for (var i = 0; i < texture.source.length; ++i)
                {
                    texture.source[i].init(_this.game);
                }
            }, null);
            for (var index = 0; index < callbacks.length; ++index)
            {
                callbacks[index](_this);
            }
        }, false);

        //   All of these settings will be able to be controlled via the Game Config
        this.config = {
            clearBeforeRender: true,
            transparent: false,
            autoResize: false,
            preserveDrawingBuffer: false,

            WebGLContextOptions: {
                alpha: true,
                antialias: true,
                premultipliedAlpha: true,
                stencil: true,
                preserveDrawingBuffer: false
            }
        };

        this.contextLost = false;
        this.maxTextures = 1;
        this.multiTexture = false;
        this.blendModes = [];
        this.gl = null;
        this.extensions = null;
        this.extensionList = {};
        this.pipelines = [];
        this.blitterBatch = null;
        this.aaQuadBatch = null;
        this.spriteBatch = null;
        this.shapeBatch = null;
        this.EffectRenderer = null;
        this.MaskRenderer =  null;
        this.currentPipeline = null;
        this.currentTexture = [];
        this.shaderCache = {};
        this.currentShader = null;
        this.resourceManager = null;
        this.currentRenderTarget = null;
        this.snapshotCallback = null;
        this.snapshotType = null;
        this.snapshotEncoder = null;

        this.scissor = {
            enabled: false,
            x: 0,
            y: 0,
            width: 0,
            height: 0
        };

        this.init();
    },

    init: function ()
    {
        this.gl = this.view.getContext('webgl', this.config.WebGLContextOptions) || this.view.getContext('experimental-webgl', this.config.WebGLContextOptions);

        if (!this.gl)
        {
            this.contextLost = true;
            throw new Error('This browser does not support WebGL. Try using the Canvas pipeline.');
        }
        var gl = this.gl;

        this.lostContext = this.getExtension('WEBGL_lose_context');

        var color = this.game.config.backgroundColor;

        this.resourceManager = new ResourceManager(gl);
    
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND);
        gl.clearColor(color.redGL, color.greenGL, color.blueGL, color.alphaGL);
        
        //  Map Blend Modes
        this.blendModes = [];

        for (var i = 0; i <= 16; i++)
        {
            this.blendModes.push({ func: [ gl.ONE, gl.ONE_MINUS_SRC_ALPHA ], equation: gl.FUNC_ADD });
        }

        //  Add
        this.blendModes[1].func = [ gl.ONE, gl.DST_ALPHA ];

        //  Multiply
        this.blendModes[2].func = [ gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA ];

        //  Screen
        this.blendModes[3].func = [ gl.ONE, gl.ONE_MINUS_SRC_COLOR ];

        this.blendMode = -1;
        this.extensions = gl.getSupportedExtensions();
        this.blitterBatch = this.addPipeline(new BlitterBatch(this.game, gl, this));
        //this.quadBatch = this.addPipeline(new QuadBatch(this.game, gl, this));
        this.spriteBatch = this.addPipeline(new SpriteBatch(this.game, gl, this));
        //this.shapeBatch = this.addPipeline(new ShapeBatch(this.game, gl, this));
        //this.EffectRenderer = this.addPipeline(new EffectRenderer(this.game, gl, this));
        //this.tileBatch = this.addPipeline(new TileBatch(this.game, gl, this));
        //this.TilemapRenderer = this.addPipeline(new TilemapRenderer(this.game, gl, this));
        //this.ParticleRenderer = this.addPipeline(new ParticleRenderer(this.game, gl, this));
        //this.MaskRenderer = this.addPipeline(new MaskRenderer(this.game, gl, this));
        this.currentPipeline = this.spriteBatch;
        this.currentVertexBuffer = null;
        this.setBlendMode(0);
        this.resize(this.width, this.height);
    },

    // https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/blendFunc
    // https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/blendFuncSeparate
    // https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/blendEquation
    // https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/blendEquationSeparate
    // https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/blendColor
    addBlendMode: function (func, equation)
    {
        var index = this.blendModes.push({ func: func, equation: equation });

        return index - 1;
    },

    updateBlendMode: function (index, func, equation)
    {
        if (this.blendModes[index])
        {
            this.blendModes[index].func = func;

            if (equation)
            {
                this.blendModes[index].equation = equation;
            }
        }

        return this;
    },

    removeBlendMode: function (index)
    {
        if (index > 16 && this.blendModes[index])
        {
            this.blendModes.splice(index, 1);
        }

        return this;
    },

    getExtension: function (name)
    {
        if (!(name in this.extensionList))
        {
            this.extensionList[name] = this.gl.getExtension(name);
        }
        return this.extensionList[name];
    },

    addContextLostCallback: function (callback)
    {
        if (this.onContextLostCallbacks.indexOf(callback) === -1)
        {
            this.onContextLostCallbacks.push(callback);
        }
    },

    addContextRestoredCallback: function (callback)
    {
        if (this.onContextRestoredCallbacks.indexOf(callback) === -1)
        {
            this.onContextRestoredCallbacks.push(callback);
        }
    },

    createTexture: function (source, width, height)
    {
        width = source ? source.width : width;
        height = source ? source.height : height;

        var gl = this.gl;
        var filter = gl.NEAREST;
        var wrap = IsSizePowerOfTwo(width, height) ? gl.REPEAT : gl.CLAMP_TO_EDGE;

        if (!source.glTexture)
        {
            if (source.scaleMode === ScaleModes.LINEAR)
            {
                filter = gl.LINEAR;
            }
            else if (source.scaleMode === ScaleModes.NEAREST || this.game.config.pixelArt)
            {
                filter = gl.NEAREST;
            }

            if (!source && typeof width === 'number' && typeof height === 'number')
            {
                source.glTexture = this.resourceManager.createTexture(
                    0,
                    filter,
                    filter,
                    wrap,
                    wrap,
                    gl.RGBA,
                    null,
                    width, height
                );
            }
            else
            {
                source.glTexture = this.resourceManager.createTexture(
                    0,
                    filter,
                    filter,
                    wrap,
                    wrap,
                    gl.RGBA,
                    source.image
                );
            }
        }

        this.currentTexture[0] = null;
    },

    setTexture: function (texture, unit)
    {
        unit = unit || 0;
        if (this.currentTexture[unit] !== texture)
        {
            var gl = this.gl;

            this.currentPipeline.flush();
            this.currentPipeline.endPass();
            
            gl.activeTexture(gl.TEXTURE0 + unit);

            if (texture !== null)
            {
                gl.bindTexture(gl.TEXTURE_2D, texture.texture);
            }
            else
            {
                gl.bindTexture(gl.TEXTURE_2D, null);
            }

            this.currentTexture[unit] = texture;
        }
    },

    setPipeline: function (pipeline)
    {
        if (this.currentPipeline !== pipeline || 
            this.currentPipeline.shouldFlush())
        {
            this.currentPipeline.flush();
            this.currentPipeline.endPass();
            this.currentPipeline = pipeline;
        }
    },

    setRenderTarget: function (renderTarget)
    {
        var gl = this.gl;

        if (this.currentRenderTarget !== renderTarget)
        {
            this.currentPipeline.flush();

            if (renderTarget !== null)
            {
                gl.bindFramebuffer(gl.FRAMEBUFFER, renderTarget.framebufferObject);

                if (renderTarget.shouldClear)
                {
                    gl.clearColor(0, 0, 0, renderTarget.clearAlpha);
                    gl.clear(gl.COLOR_BUFFER_BIT);
                    renderTarget.shouldClear = false;
                }
            }
            else
            {
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                gl.viewport(0, 0, this.width, this.height);
            }

            this.currentRenderTarget = renderTarget;
        }
    },

    resize: function (width, height)
    {
        var resolution = this.game.config.resolution;

        this.width = width * resolution;
        this.height = height * resolution;

        this.view.width = this.width;
        this.view.height = this.height;

        if (this.autoResize)
        {
            this.view.style.width = (this.width / resolution) + 'px';
            this.view.style.height = (this.height / resolution) + 'px';
        }

        this.gl.viewport(0, 0, this.width, this.height);

        for (var i = 0, l = this.pipelines.length; i < l; ++i)
        {
            //this.pipelines[i].bind();
            //this.pipelines[i].resize(width, height, resolution);
        }

        //this.currentPipeline.bind();
    },

    //  Call at the start of the render loop
    preRender: function ()
    {
        //  No point rendering if our context has been blown up!
        if (this.contextLost)
        {
            return;
        }

        this.setRenderTarget(null);
        //  Add Pre-render hook

        var gl = this.gl;
        var color = this.game.config.backgroundColor;

        gl.clearColor(color.redGL, color.greenGL, color.blueGL, color.alphaGL);

        // Some drivers require to call glClear
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

        this.setBlendMode(BlendModes.NORMAL);
        this.gl.viewport(0, 0, this.width, this.height);
    },

    /**
     * Renders a single Scene.
     *
     * @method render
     * @param {Phaser.Scene} scene - The Scene to be rendered.
     * @param {number} interpolationPercentage - The cumulative amount of time that hasn't been simulated yet, divided
     *   by the amount of time that will be simulated the next time update()
     *   runs. Useful for interpolating frames.
     */
    render: function (scene, children, interpolationPercentage, camera)
    {
        if (this.contextLost) return;
        var gl = this.gl;
        var quadBatch = this.quadBatch;

        this.scissor.enabled = (camera.x !== 0 || camera.y !== 0 || camera.width !== gl.canvas.width || camera.height !== gl.canvas.height);

        this.setRenderTarget(null);

        if (this.scissor.enabled)
        {
            gl.enable(gl.SCISSOR_TEST);

            this.scissor.x = camera.x;
            this.scissor.y = gl.drawingBufferHeight - camera.y - camera.height;
            this.scissor.width = camera.width;
            this.scissor.height = camera.height;

            gl.scissor(this.scissor.x, this.scissor.y, this.scissor.width, this.scissor.height);
        }

        if (camera.backgroundColor.alphaGL > 0)
        {
            var color = camera.backgroundColor;

            //quadBatch.bind();
            //quadBatch.add(
            //    camera.x, camera.y, camera.width, camera.height,
            //    color.redGL, color.greenGL, color.blueGL, color.alphaGL
            //);
            //quadBatch.flush();
            //this.currentPipeline.bind();
        }

        var list = children.list;
        var length = list.length;
        var pipeline;

        for (var index = 0; index < length; ++index)
        {
            var child = list[index];

            if (!child.willRender())
            {
                continue;
            }

            if (child.blendMode !== this.blendMode)
            {
                this.setBlendMode(child.blendMode);
            }

            if (child.mask)
            {
                child.mask.preRenderWebGL(this, child, camera);
            }

            // drawing child
            child.renderWebGL(this, child, interpolationPercentage, camera);

            if (child.mask)
            {
                child.mask.postRenderWebGL(this, child);
            }

            pipeline = this.currentPipeline;

            if (pipeline.shouldFlush())
            {
                pipeline.flush();
            }
        }
        
        this.currentPipeline.flush();
        
        if (camera._fadeAlpha > 0 || camera._flashAlpha > 0)
        {
            this.setRenderTarget(null);
            this.setBlendMode(BlendModes.NORMAL);

            // // fade rendering
            // quadBatch.add(
            //     camera.x, camera.y, camera.width, camera.height,
            //     camera._fadeRed,
            //     camera._fadeGreen,
            //     camera._fadeBlue,
            //     camera._fadeAlpha
            // );
            // // flash rendering
            // quadBatch.add(
            //     camera.x, camera.y, camera.width, camera.height,
            //     camera._flashRed,
            //     camera._flashGreen,
            //     camera._flashBlue,
            //     camera._flashAlpha
            // );
            // quadBatch.flush();
            // this.currentPipeline.bind();
        }

        if (this.scissor.enabled)
        {
            gl.disable(gl.SCISSOR_TEST);
        }
    },

    //  Called at the end of the render loop (tidy things up, etc)
    postRender: function ()
    {
        if (this.contextLost) return;

        this.currentPipeline.flush();

        if (this.snapshotCallback)
        {
            this.snapshotCallback(WebGLSnapshot(this.view, this.snapshotType, this.snapshotEncoder));
            this.snapshotCallback = null;
        }

        //  Add Post-render hook

        // console.log('%c render end ', 'color: #ffffff; background: #ff0000;');
    },

    snapshot: function (callback, type, encoderOptions)
    {
        this.snapshotCallback = callback;
        this.snapshotType = type;
        this.snapshotEncoder = encoderOptions;
    },

    createFBO: function () {},

    setBlendMode: function (newBlendMode)
    {
        var gl = this.gl;

        if (newBlendMode === BlendModes.SKIP_CHECK)
        {
            return;
        }

        var pipeline = this.currentPipeline;

        if (this.blendMode !== newBlendMode)
        {
            if (pipeline)
            {
                pipeline.flush();
            }

            var blend = this.blendModes[newBlendMode].func;

            gl.enable(gl.BLEND);
            gl.blendEquation(this.blendModes[newBlendMode].equation);

            if (blend.length > 2)
            {
                gl.blendFuncSeparate(blend[0], blend[1], blend[2], blend[3]);
            }
            else
            {
                gl.blendFunc(blend[0], blend[1]);
            }

            this.blendMode = newBlendMode;
        }
    },

    addPipeline: function (pipelineInstance)
    {
        var index = this.pipelines.indexOf(pipelineInstance);

        if (index < 0)
        {
            this.pipelines.push(pipelineInstance);
            return pipelineInstance;
        }

        return null;
    },

    setTextureFilterMode: function (texture, filterMode)
    {
        var gl = this.gl;
        var glFilter = [ gl.LINEAR, gl.NEAREST ][filterMode];

        gl.bindTexture(gl.TEXTURE_2D, texture.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, glFilter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, glFilter);

        if (this.currentTexture[0] !== null)
        {
            gl.bindTexture(gl.TEXTURE_2D, this.currentTexture[0].texture);
        }
        else
        {
            gl.bindTexture(gl.TEXTURE_2D, null);
        }

        return texture;
    },

    uploadCanvasToGPU: function (srcCanvas, dstTexture, shouldReallocate)
    {
        var gl = this.gl;

        if (!dstTexture)
        {
            dstTexture = new Resources.Texture(null, 0, 0);

            //  Only call this once
            dstTexture.texture = gl.createTexture();
        }

        if (dstTexture != this.currentTexture[0])
        {
            this.currentPipeline.flush();
        }

        gl.activeTexture(gl.TEXTURE0);

        if (!shouldReallocate)
        {
            //  Update resource
            gl.bindTexture(gl.TEXTURE_2D, dstTexture.texture);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas);
        }
        else
        {
            //  Allocate or Reallocate resource
            gl.bindTexture(gl.TEXTURE_2D, dstTexture.texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            dstTexture.width = srcCanvas.width;
            dstTexture.height = srcCanvas.height;
        }

        //  We must rebind old texture
        if (this.currentTexture.length > 0 && dstTexture != this.currentTexture[0] && this.currentTexture[0] !== null)
        {
            gl.bindTexture(gl.TEXTURE_2D, this.currentTexture[0].texture);
        }

        return dstTexture;
    },

    destroy: function ()
    {
        if (this.lostContext)
        {
            this.lostContext.loseContext();
        }
        this.gl = null;
    }

});

module.exports = WebGLpipeline;